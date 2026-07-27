/* ═══════════════════════════════════════════════════════════
   Shared gate for the owner-only endpoints.

   Anything that reads customer details or writes to Airtable goes
   through here, so the rule lives in one place and cannot drift
   between endpoints.
   ═══════════════════════════════════════════════════════════ */

export function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Owner-Key",
      "Access-Control-Allow-Methods": "GET, PATCH, POST, OPTIONS",
      /* Never cached. These responses are owner-only and often
         contain customer contact details. */
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

/* Length-independent comparison, so response timing leaks nothing
   about how much of the key was right. */
function keyMatches(supplied, expected) {
  if (typeof supplied !== "string" || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns null when the request may proceed, or a Response to send back.
 *
 * Fails CLOSED: if OWNER_KEY is not set, everything is refused. An
 * unset variable must never mean "let everybody in".
 */
export function checkOwner(request) {
  const ownerKey = process.env.OWNER_KEY;

  if (!ownerKey) {
    return json({
      ok: false,
      error: "locked",
      message: "This is switched off. Set OWNER_KEY in Netlify to enable it."
    }, 503);
  }

  if (!keyMatches(request.headers.get("x-owner-key"), ownerKey)) {
    return json({ ok: false, error: "unauthorized", message: "Wrong or missing owner key." }, 401);
  }

  return null;
}

/** Talks to Airtable without ever echoing its response body back out. */
export async function airtable(method, path, body) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN is not set on this site.");

  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) throw new Error(`Airtable responded ${response.status}`);
  return response.json();
}
