/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — send one text through Quo

   POST /api/quo-send   { to: "+18175551234", message: "..." }

   This is the one place on the site that sends a message rather than
   just reading them — used by the dashboard's "mark a cart Sold"
   flow to text a thank-you and a review link. Owner-gated, and every
   send is a deliberate click in the dashboard, never automatic:
   Quo bills API-sent texts against a small prepaid balance, and a
   proactive text like this one is exactly the kind a recipient needs
   to have actually consented to receive.

   Environment variables:
     QUO_API_KEY   same key /api/quo already uses
     OWNER_KEY     same passphrase every owner endpoint uses
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner } from "../lib/owner-auth.mjs";

export const config = { path: "/api/quo-send" };

const API = "https://api.quo.com/v1";

async function quo(path, key, init) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: key, "Content-Type": "application/json", ...(init && init.headers) }
  });
  if (!response.ok) {
    const error = new Error(`Quo responded ${response.status}`);
    error.status = response.status;
    try { error.body = await response.json(); } catch { /* not JSON */ }
    throw error;
  }
  return response.json();
}

/* Last ten digits, then back to E.164 — tolerates whatever shape the
   dashboard's phone input holds (a lead's stored number, or someone
   typing it in by hand) without rejecting a genuine number over a
   formatting difference. */
function toE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? "+1" + ten : null;
}

function quoMessage(error) {
  if (error.status === 401 || error.status === 403) {
    return "Quo rejected the API key. Create a new one in Quo and update QUO_API_KEY in Netlify.";
  }
  if (error.status === 402 || (error.body && /credit|balance/i.test(JSON.stringify(error.body)))) {
    return "Quo's messaging balance is too low to send this. Add funds under Plan & Billing in Quo.";
  }
  if (error.status === 429) return "Quo is rate limiting us. Wait a moment and try again.";
  return error.message || "Quo would not send that message.";
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only." }, 405);
  }

  const key = process.env.QUO_API_KEY;
  if (!key) {
    /* Same shape as /api/quo's own "not configured" answer, so the
       dashboard can tell "nothing is set up yet" apart from "the send
       actually failed" the same way in both places. */
    return json({
      ok: false,
      configured: false,
      error: "not_configured",
      message: "Quo is not connected yet. Add QUO_API_KEY in Netlify to send texts."
    }, 200);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid", message: "Could not read the request." }, 400);
  }

  const to = toE164(input.to);
  if (!to) {
    return json({ ok: false, error: "invalid", message: "A valid 10-digit phone number is required." }, 400);
  }

  const content = String(input.message == null ? "" : input.message).trim().slice(0, 1000);
  if (!content) {
    return json({ ok: false, error: "invalid", message: "A message is required." }, 400);
  }

  try {
    /* Which of our own numbers to send from. This account has exactly
       one at the time of writing, so the first is correct; an
       QUO_FROM_NUMBER override exists for the day a second line — a
       parts counter, a second location — makes that ambiguous. */
    const from = process.env.QUO_FROM_NUMBER || await (async () => {
      const numbers = await quo("/phone-numbers", key);
      const first = (numbers.data || [])[0];
      if (!first || !first.number) throw new Error("This Quo account has no phone number to send from.");
      return first.number;
    })();

    await quo("/messages", key, {
      method: "POST",
      body: JSON.stringify({ content, from, to: [to] })
    });

    return json({ ok: true }, 200);
  } catch (error) {
    return json({ ok: false, error: "upstream_error", message: quoMessage(error) }, 502);
  }
}
