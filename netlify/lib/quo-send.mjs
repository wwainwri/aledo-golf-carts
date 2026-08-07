/* ═══════════════════════════════════════════════════════════
   Shared "send one text through Quo".

   Two callers:
     • netlify/functions/quo-send.mjs — the owner-gated endpoint the
       dashboard's "mark a cart Sold" flow uses. A person clicks Send.
     • netlify/functions/lead.mjs — fires automatically the moment a
       website inquiry is recorded, thanking whoever just submitted
       the form. Nobody clicks anything for this one.

   That second use only exists because the phone number and consent
   both come from the same place: the person's own form submission,
   with the TCPA checkbox every form already requires before it will
   submit. A cart-sold thank-you couldn't assume that — there was no
   stored "who bought this" field — which is why that one is still a
   dashboard-side confirm, not automatic. This function does not know
   or care which caller it is; the consent decision is the caller's.

   Environment variables:
     QUO_API_KEY      a Quo API key (Settings → API)
     QUO_FROM_NUMBER  optional override — see below
   ═══════════════════════════════════════════════════════════ */

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
   phone number arrives in (a lead's own typed-in number, a dashboard
   text input) without rejecting a genuine number over formatting. */
export function toE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? "+1" + ten : null;
}

export function quoSendErrorMessage(error) {
  if (error.status === 401 || error.status === 403) {
    return "Quo rejected the API key. Create a new one in Quo and update QUO_API_KEY in Netlify.";
  }
  if (error.status === 402 || (error.body && /credit|balance/i.test(JSON.stringify(error.body)))) {
    return "Quo's messaging balance is too low to send this. Add funds under Plan & Billing in Quo.";
  }
  if (error.status === 429) return "Quo is rate limiting us. Wait a moment and try again.";
  return error.message || "Quo would not send that message.";
}

/**
 * Sends one text. Throws on any failure — a missing key, a bad phone
 * number, an empty message, or Quo itself rejecting the send — with
 * `error.configured = false` specifically for "no key set yet", so a
 * caller can tell that apart from every other kind of failure.
 */
export async function sendQuoText(message, to) {
  const key = process.env.QUO_API_KEY;
  if (!key) {
    const error = new Error("Quo is not connected yet. Add QUO_API_KEY in Netlify to send texts.");
    error.configured = false;
    throw error;
  }

  const phone = toE164(to);
  if (!phone) throw new Error("A valid 10-digit phone number is required.");

  const content = String(message == null ? "" : message).trim().slice(0, 1000);
  if (!content) throw new Error("A message is required.");

  /* Which of our own numbers to send from. This account has exactly
     one at the time of writing, so the first is correct; the
     QUO_FROM_NUMBER override exists for the day a second line — a
     parts counter, a second location — makes that ambiguous. */
  const from = process.env.QUO_FROM_NUMBER || await (async () => {
    const numbers = await quo("/phone-numbers", key);
    const first = (numbers.data || [])[0];
    if (!first || !first.number) {
      /* Not a bad `to` or `message` — the caller did everything right.
         Tagged so quo-send.mjs answers 502 (something is wrong upstream)
         rather than 400 (you sent something invalid). */
      const error = new Error("This Quo account has no phone number to send from.");
      error.upstream = true;
      throw error;
    }
    return first.number;
  })();

  await quo("/messages", key, {
    method: "POST",
    body: JSON.stringify({ content, from, to: [phone] })
  });
}
