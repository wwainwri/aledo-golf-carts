/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — draft a cart description with Gemini

   POST /api/generate-description
   { name, year, seats, type, battery, color }
   → { ok: true, short, long }

   Owner-gated, like every write-adjacent endpoint. This never touches
   Airtable — it drafts text for the dashboard to drop into the
   description fields, for the owner to read and edit before saving.

   The prompt is deliberately restricted to the fields it is given. A
   golf cart dealer's listing is a factual claim about a specific
   vehicle; letting a model invent a motor wattage or a warranty term
   nobody entered is how a "helpful" description becomes a false one.

   Environment variables:
     GEMINI_API_KEY   a Google AI Studio API key
     OWNER_KEY        the same passphrase every owner endpoint uses
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner } from "../lib/owner-auth.mjs";

export const config = { path: "/api/generate-description" };

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 200);
}

function buildPrompt(cart) {
  const facts = [];
  if (cart.year) facts.push(`Year: ${cart.year}`);
  if (cart.name) facts.push(`Model name: ${cart.name}`);
  if (cart.seats) facts.push(`Seats: ${cart.seats}`);
  if (cart.type) facts.push(`Condition: ${cart.type}`);
  if (cart.battery) facts.push(`Battery: ${cart.battery}`);
  if (cart.color) facts.push(`Color: ${cart.color}`);

  return `You are writing golf cart listing copy for Aledo Golf Carts, a small, honest, family-run dealership in Aledo, Texas. The tone is warm and straightforward — never hypey, never like a used-car-lot pitch.

Facts about this specific cart (this is everything you know — do not invent, assume, or add any other detail):
${facts.join("\n") || "(no details given)"}

Write two descriptions of this cart, using ONLY the facts above:

1. "short": one sentence, under 20 words, for a listing card in a grid of other carts.
2. "long": three to five sentences, for this cart's own page. Warm and specific to what is actually known — do not invent technical specs (motor power, voltage, amp-hours, top speed), warranty terms, or features that were not given above. If few facts are given, write a shorter, honest description rather than padding it with invented detail.

Respond with ONLY this JSON object, no markdown formatting, no code fences, nothing else:
{"short": "...", "long": "..."}`;
}

/* Gemini sometimes wraps JSON in a \`\`\`json code fence even when told
   not to. Strip it before parsing rather than failing on it. */
function extractJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(stripped);
}

function geminiMessage(status, body) {
  if (status === 400) return "Gemini rejected the request — check GEMINI_API_KEY in Netlify.";
  if (status === 403) return "Gemini rejected the API key. Create a new one in Google AI Studio and update GEMINI_API_KEY in Netlify.";
  if (status === 429) return "Gemini is rate limiting us. Wait a moment and try again.";
  if (status === 503) return "Gemini is overloaded right now. Try again in a moment.";
  return (body && body.error && body.error.message) || "Gemini could not generate a description.";
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only." }, 405);
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return json({
      ok: false,
      configured: false,
      error: "not_configured",
      message: "AI descriptions are not connected yet. Add GEMINI_API_KEY in Netlify."
    }, 200);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid", message: "Could not read the request." }, 400);
  }

  const cart = {
    name: clean(input.name, 200),
    year: clean(input.year, 10),
    seats: clean(input.seats, 10),
    type: clean(input.type, 40),
    battery: clean(input.battery, 60),
    color: clean(input.color, 60)
  };

  if (!cart.name) {
    return json({ ok: false, error: "invalid", message: "Enter a cart name first." }, 400);
  }

  try {
    const response = await fetch(`${GEMINI_API}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(cart) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.6
        }
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json({ ok: false, error: "upstream_error", message: geminiMessage(response.status, payload) }, 502);
    }

    const text = payload.candidates && payload.candidates[0] &&
      payload.candidates[0].content && payload.candidates[0].content.parts &&
      payload.candidates[0].content.parts[0] && payload.candidates[0].content.parts[0].text;

    if (!text) {
      /* A prompt Gemini's safety filter blocks comes back 200 with no
         candidates rather than an error — worth naming specifically. */
      const blocked = payload.promptFeedback && payload.promptFeedback.blockReason;
      return json({
        ok: false,
        error: "upstream_error",
        message: blocked ? `Gemini declined to generate this (${blocked}).` : "Gemini returned nothing usable."
      }, 502);
    }

    let parsed;
    try {
      parsed = extractJson(text);
    } catch {
      return json({ ok: false, error: "upstream_error", message: "Gemini's response could not be read." }, 502);
    }

    const short = String(parsed.short || "").trim();
    const long = String(parsed.long || "").trim();
    if (!short || !long) {
      return json({ ok: false, error: "upstream_error", message: "Gemini did not return both descriptions." }, 502);
    }

    return json({ ok: true, short, long }, 200);
  } catch (error) {
    return json({ ok: false, error: "upstream_error", message: "Could not reach Gemini." }, 502);
  }
}
