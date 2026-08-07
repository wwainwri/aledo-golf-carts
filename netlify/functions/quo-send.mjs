/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — send one text through Quo (owner-triggered)

   POST /api/quo-send   { to: "+18175551234", message: "..." }

   Used by the dashboard's "mark a cart Sold" flow to text a thank-you
   and a review link. Owner-gated, and every send here is a deliberate
   click in the dashboard — never automatic. The actual send logic
   lives in netlify/lib/quo-send.mjs, shared with lead.mjs's automatic
   thank-you-on-inquiry text; this file is just the owner-gated door
   onto it.

   Environment variables:
     QUO_API_KEY   same key /api/quo already uses
     OWNER_KEY     same passphrase every owner endpoint uses
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner } from "../lib/owner-auth.mjs";
import { sendQuoText, quoSendErrorMessage } from "../lib/quo-send.mjs";

export const config = { path: "/api/quo-send" };

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only." }, 405);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid", message: "Could not read the request." }, 400);
  }

  try {
    await sendQuoText(input.message, input.to);
    return json({ ok: true }, 200);
  } catch (error) {
    if (error.configured === false) {
      /* Same shape as /api/quo's own "not configured" answer, so the
         dashboard can tell "nothing is set up yet" apart from "the
         send actually failed" the same way in both places. */
      return json({ ok: false, configured: false, error: "not_configured", message: error.message }, 200);
    }
    if (error.status || error.upstream) {
      return json({ ok: false, error: "upstream_error", message: quoSendErrorMessage(error) }, 502);
    }
    /* No .status means it never reached Quo — a bad phone number or an
       empty message, both caught before the request went out. */
    return json({ ok: false, error: "invalid", message: error.message }, 400);
  }
}
