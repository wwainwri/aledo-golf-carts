/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — Quo phone activity

   Reads the business phone line (Quo, formerly OpenPhone) and hands
   the dashboard one merged timeline of calls and texts.

       GET /api/quo                  recent activity
       GET /api/quo?callId=AC123     Sona's summary of one call

   ── Why this is a fan-out rather than one request ──
   Quo has no "recent activity" endpoint. Both GET /calls and
   GET /messages REQUIRE a `participants` parameter, so each one can
   only answer "what happened between my number and THIS person".

   GET /conversations is the way in: it needs nothing but maxResults
   and comes back with every recent thread and who is on it. So the
   shape here is:

       1. which numbers do we own            /phone-numbers
       2. who have we been talking to        /conversations
       3. for each of those, what was said   /messages  +  /calls
       4. merge, sort, and work out what matters

   ── Why it is capped ──
   Quo allows 10 requests a second per key. Step 3 costs two requests
   per conversation, so the number of conversations is deliberately
   limited and the requests go out in small waves. Without that, a busy
   week would trip the rate limit and return nothing at all.

   ── What it needs ──
   QUO_API_KEY   a Quo API key (Settings → Integrations → API).
                 Held only in Netlify; never reaches the browser.
   OWNER_KEY     the same key that already guards leads and inventory.

   Without QUO_API_KEY this reports that it is switched off rather
   than erroring, so the dashboard can say something useful.
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner } from "../lib/owner-auth.mjs";

export const config = { path: "/api/quo" };

const API = "https://api.quo.com/v1";

/* How far back to look, and how wide to cast. Both are a trade
   against Quo's rate limit — see the fan-out note above. */
const DAYS_BACK = Number(process.env.QUO_DAYS_BACK) || 14;
const MAX_CONVERSATIONS = Number(process.env.QUO_MAX_CONVERSATIONS) || 15;
const PER_CONVERSATION = 10;

/* Requests per wave. Quo's ceiling is 10 a second; 6 leaves headroom
   for anything else using the same key at the same moment. */
const WAVE = 6;

/* Quo wants the key raw in Authorization — no "Bearer" prefix. Sending
   one is the single most common way this returns 401. */
async function quo(path, key) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: key, "Content-Type": "application/json" }
  });

  if (!response.ok) {
    const error = new Error(`Quo responded ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/* Same, but a failure returns null instead of throwing. Used for the
   per-conversation reads, where one bad thread should not take the
   whole timeline down. */
async function quoQuiet(path, key) {
  try {
    return await quo(path, key);
  } catch {
    return null;
  }
}

/* `participants` is an array, and Quo's spec does not say how it wants
   one written in a query string. The OpenAPI default is a repeated key
   (`participants=+1555…`), but OpenPhone's own published examples use
   `participants[]=+1555…`. Both are common; only one is accepted, and
   guessing wrong means this panel is permanently empty with a 400 that
   nothing surfaces.

   So it tries the spec form, and falls back to the bracket form if that
   is rejected. Which one worked is remembered for the rest of the
   request, so the cost is one extra call at most, once. */
let participantStyle = null;

function buildQuery(path, conversation, since, style) {
  const participants = style === "bracket" ? "participants[]" : "participants";
  return `${path}?phoneNumberId=${encodeURIComponent(conversation.phoneNumberId)}` +
    `&${participants}=${encodeURIComponent(conversation.other)}` +
    `&maxResults=${PER_CONVERSATION}` +
    `&createdAfter=${encodeURIComponent(since)}`;
}

async function listFor(path, conversation, since, key) {
  /* Both forms are always available. The remembered one goes first so
     the usual case costs one request, but it is never the only option:
     this memory outlives a single request on a warm function, and a
     style that is remembered wrongly must not be able to wedge the
     panel shut for good. */
  const order = participantStyle === "bracket"
    ? ["bracket", "plain"]
    : ["plain", "bracket"];

  for (const style of order) {
    try {
      const payload = await quo(buildQuery(path, conversation, since, style), key);
      participantStyle = style;
      return (payload && payload.data) || [];
    } catch (error) {
      /* Only a rejected request is worth retrying differently. A 500 or
         a network blip means try again another day, not another shape. */
      if (error.status !== 400) return [];
    }
  }
  return [];
}

async function inWaves(items, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += WAVE) {
    const wave = items.slice(i, i + WAVE);
    results.push(...await Promise.all(wave.map(worker)));
    /* A breath between waves, so a burst cannot outrun the limit. */
    if (i + WAVE < items.length) await new Promise((r) => setTimeout(r, 250));
  }
  return results;
}

/* (817) 776-2175 reads better than +18177762175 on a dashboard. */
function prettyNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(value || "");
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/* Last ten digits, for comparing numbers that are written differently
   in different systems — Quo says +18175551234, a lead form says
   817-555-1234, and they are the same person. */
export function numberKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/* Quo's statuses split into the only distinction that matters to a
   dealer: did a person actually get through. */
const MISSED = new Set(["missed", "no-answer", "busy", "abandoned", "canceled", "failed"]);

function toCall(call, names) {
  const ours = new Set(names.ourKeys);
  /* The other end of the call is whichever participant is not us. */
  const other = (call.participants || []).find((p) => !ours.has(numberKey(p))) ||
    (call.participants || [])[0] || "";

  const missed = MISSED.has(String(call.status || "").toLowerCase());

  return {
    kind: "call",
    id: call.id,
    at: call.createdAt,
    direction: call.direction === "outgoing" ? "out" : "in",
    with: other,
    withPretty: prettyNumber(other),
    withName: names.byKey[numberKey(other)] || "",
    status: call.status || "",
    duration: Number(call.duration) || 0,
    missed,
    /* A missed call nobody rang back is the whole point of this panel,
       but it can only be worked out once the timeline is assembled. */
    answered: !missed && Boolean(call.answeredAt),
    /* Sona is Quo's AI receptionist. Worth showing: a call it handled
       has been dealt with, and one it did not has not. */
    aiHandled: call.aiHandled === true
  };
}

function toText(message, names) {
  const incoming = message.direction !== "outgoing";
  const other = incoming ? message.from : (message.to || [])[0] || "";

  return {
    kind: "text",
    id: message.id,
    at: message.createdAt,
    direction: incoming ? "in" : "out",
    with: other,
    withPretty: prettyNumber(other),
    withName: names.byKey[numberKey(other)] || "",
    text: String(message.text || ""),
    status: message.status || ""
  };
}

/**
 * A missed call counts as unreturned when nothing went back out to that
 * number afterwards — no callback, no text. That is the one number on
 * this whole dashboard that is money walking away.
 */
function findUnreturned(activity) {
  const repliedAfter = new Map();

  /* Oldest first, remembering the last time we reached out to each. */
  for (let i = activity.length - 1; i >= 0; i--) {
    const item = activity[i];
    const key = numberKey(item.with);
    if (!key) continue;
    if (item.direction === "out") repliedAfter.set(key, item.at);
  }

  return activity.filter((item) => {
    if (item.kind !== "call" || !item.missed || item.direction !== "in") return false;
    const replied = repliedAfter.get(numberKey(item.with));
    return !replied || new Date(replied) <= new Date(item.at);
  });
}

async function loadActivity(key) {
  /* 1. our own numbers */
  const numbersPayload = await quo("/phone-numbers", key);
  const numbers = (numbersPayload.data || []).map((n) => ({
    id: n.id,
    number: n.number || "",
    pretty: prettyNumber(n.number),
    name: n.name || ""
  }));

  if (!numbers.length) {
    return { numbers: [], activity: [], unreturned: [], stats: emptyStats() };
  }

  const names = {
    ourKeys: numbers.map((n) => numberKey(n.number)),
    byKey: {}
  };

  /* 2. who we have been talking to */
  const since = new Date(Date.now() - DAYS_BACK * 86400000).toISOString();

  const conversationsPayload = await quo(
    `/conversations?maxResults=${MAX_CONVERSATIONS}&excludeInactive=true&updatedAfter=${encodeURIComponent(since)}`,
    key
  );

  const conversations = (conversationsPayload.data || [])
    .map((c) => {
      const ours = new Set(names.ourKeys);
      const other = (c.participants || []).find((p) => !ours.has(numberKey(p))) ||
        (c.participants || [])[0] || "";
      if (c.name && other) names.byKey[numberKey(other)] = c.name;
      return { phoneNumberId: c.phoneNumberId, other, lastActivityAt: c.lastActivityAt };
    })
    .filter((c) => c.other && c.phoneNumberId)
    .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0))
    .slice(0, MAX_CONVERSATIONS);

  /* 3. what was actually said in each */
  const results = await inWaves(conversations, async (conversation) => {
    const [messages, calls] = await Promise.all([
      listFor("/messages", conversation, since, key),
      listFor("/calls", conversation, since, key)
    ]);
    return { messages, calls };
  });

  /* 4. one timeline.

     Keyed by id on the way in: threads can overlap — a group thread and
     a direct one can both carry the same message — and the same item
     appearing twice in a call log reads as a real duplicate event
     rather than as a display quirk. */
  const byId = new Map();
  for (const result of results) {
    for (const call of result.calls) {
      const item = toCall(call, names);
      if (item.id) byId.set("c" + item.id, item);
    }
    for (const message of result.messages) {
      const item = toText(message, names);
      if (item.id) byId.set("m" + item.id, item);
    }
  }

  const activity = [...byId.values()].sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    numbers,
    activity,
    unreturned: findUnreturned(activity),
    stats: buildStats(activity)
  };
}

function emptyStats() {
  return { callsToday: 0, textsToday: 0, missedToday: 0, inboundToday: 0, unreturned: 0 };
}

function buildStats(activity) {
  /* "Today" in Texas, not in UTC — a call at 7pm should not count as
     tomorrow's because the server thinks in GMT. */
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const isToday = (at) =>
    new Date(at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) === today;

  const stats = emptyStats();
  for (const item of activity) {
    if (!isToday(item.at)) continue;
    if (item.kind === "call") {
      stats.callsToday++;
      if (item.missed && item.direction === "in") stats.missedToday++;
    } else {
      stats.textsToday++;
    }
    if (item.direction === "in") stats.inboundToday++;
  }
  return stats;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  const key = process.env.QUO_API_KEY;
  if (!key) {
    /* Not an error. The dashboard shows a "connect Quo" card, so this
       has to be distinguishable from the line genuinely being broken. */
    return json({
      ok: true,
      configured: false,
      message: "Quo is not connected yet. Add QUO_API_KEY in Netlify to see calls and texts.",
      numbers: [], activity: [], unreturned: [], stats: emptyStats()
    }, 200);
  }

  const callId = new URL(request.url).searchParams.get("callId");

  /* One call's AI summary, fetched only when the owner opens it. Doing
     this for every call in the list would double the request count for
     something most of them do not have. */
  if (callId) {
    if (!/^[A-Za-z0-9_-]{5,60}$/.test(callId)) {
      return json({ ok: false, error: "invalid", message: "Bad call id." }, 400);
    }
    try {
      const summary = await quo(`/call-summaries/${encodeURIComponent(callId)}`, key);
      const body = summary.data || {};
      return json({
        ok: true,
        configured: true,
        summary: {
          status: body.status || "",
          points: Array.isArray(body.summary) ? body.summary : [],
          nextSteps: Array.isArray(body.nextSteps) ? body.nextSteps : []
        }
      }, 200);
    } catch (error) {
      /* Most calls have no summary — short ones, outgoing ones, and any
         call on a plan without it. Not worth an error face. */
      if (error.status === 404) {
        return json({ ok: true, configured: true, summary: null }, 200);
      }
      return json({ ok: false, error: "upstream_error", message: quoMessage(error) }, 502);
    }
  }

  try {
    const payload = await loadActivity(key);
    return json({ ok: true, configured: true, updated: new Date().toISOString(), ...payload }, 200);
  } catch (error) {
    return json({ ok: false, error: "upstream_error", message: quoMessage(error) }, 502);
  }
}

function quoMessage(error) {
  if (error.status === 401 || error.status === 403) {
    return "Quo rejected the API key. Create a new one in Quo and update QUO_API_KEY in Netlify.";
  }
  if (error.status === 429) {
    return "Quo is rate limiting us. Wait a moment and refresh.";
  }
  return error.message || "Could not read the phone line.";
}
