/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — cart photo upload

   Takes one photo from the owner dashboard and puts it into the
   Gallery attachment field of a cart.

       POST /api/photo-upload
       X-Owner-Key: <the value of OWNER_KEY>

       { "id": "recXXXX", "filename": "…", "contentType": "image/jpeg",
         "data": "<base64, no data: prefix>" }

   Uploading is its own endpoint rather than part of /api/cart because
   Airtable takes file bytes at a different host, content.airtable.com,
   with a different request shape entirely. Deleting and reordering
   photos stay on /api/cart, which only has to send back a list of ids.

   ── Why the dashboard shrinks photos before sending ──
   Airtable refuses attachments over 5MB, and a base64 body is a third
   bigger than the file it carries, which puts a modern phone photo over
   the request limit before Airtable ever sees it. The dashboard scales
   every photo down first — see resizeForUpload() in dashboard.js. The
   ceiling here is the backstop, not the plan.
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner } from "../lib/owner-auth.mjs";

export const config = { path: "/api/photo-upload" };

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const GALLERY_FIELD = process.env.AIRTABLE_GALLERY_FIELD || "Gallery";

/* Comfortably inside both Airtable's 5MB attachment cap and the
   request size a Netlify function will accept once base64 has added
   its third. */
const MAX_BYTES = 3.5 * 1024 * 1024;

/* What a golf cart photo can legitimately be. Anything else is refused
   rather than stored, because whatever lands here is served straight
   back out to the public website. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/* Airtable derives nothing from the filename, but it is what the owner
   sees in Airtable's own interface, so it should stay readable and
   must not carry a path. */
function safeFilename(value, contentType) {
  const extension = contentType === "image/png" ? "png"
    : contentType === "image/webp" ? "webp" : "jpg";

  const cleaned = String(value || "")
    .replace(/[\\/]/g, " ")
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .trim()
    .slice(0, 80);

  if (!cleaned) return `cart-photo.${extension}`;
  return /\.[A-Za-z0-9]{2,5}$/.test(cleaned) ? cleaned : `${cleaned}.${extension}`;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  if (request.method !== "POST") {
    return json({ ok: false, error: "POST a photo to add it." }, 405);
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    return json({ ok: false, error: "not_configured", message: "AIRTABLE_TOKEN is not set." }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }

  const id = String(input.id || "").trim();
  if (!/^rec[A-Za-z0-9]{10,20}$/.test(id)) {
    return json({ ok: false, error: "invalid", message: "A valid cart id is required." }, 400);
  }

  const contentType = String(input.contentType || "").toLowerCase().trim();
  if (!ALLOWED.has(contentType)) {
    return json({
      ok: false,
      error: "invalid",
      message: "Photos must be JPEG, PNG, or WebP."
    }, 400);
  }

  /* Tolerate a full data: URL, since that is what a FileReader hands
     back and it is an easy thing to forward by mistake. */
  const data = String(input.data || "").replace(/^data:[^,]*,/, "").trim();
  if (!data) {
    return json({ ok: false, error: "invalid", message: "The photo was empty." }, 400);
  }

  /* Base64 carries three bytes in every four characters, so this is the
     decoded size without paying to decode it. */
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((data.length * 3) / 4) - padding;
  if (bytes > MAX_BYTES) {
    return json({
      ok: false,
      error: "too_big",
      message: "That photo is too large. Please use one under 3.5MB."
    }, 413);
  }

  try {
    const response = await fetch(
      `https://content.airtable.com/v0/${BASE_ID}/${id}/${encodeURIComponent(GALLERY_FIELD)}/uploadAttachment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contentType,
          file: data,
          filename: safeFilename(input.filename, contentType)
        })
      }
    );

    if (!response.ok) {
      /* Airtable's own message can restate the request, so it is not
         passed back out. The status is enough to act on. */
      const message = response.status === 404
        ? "That cart no longer exists in Airtable."
        : response.status === 422
          ? "Airtable would not accept that photo."
          : `Airtable responded ${response.status}.`;
      return json({ ok: false, error: "upstream_error", message }, 502);
    }

    const saved = await response.json();

    /* Airtable answers with the whole field keyed by field id, not by
       name, so the count comes from whichever key holds a list. */
    const fields = saved.fields || {};
    const list = Object.values(fields).find((value) => Array.isArray(value)) || [];

    return json({ ok: true, id, count: list.length }, 200);
  } catch (error) {
    return json({
      ok: false,
      error: "upstream_error",
      message: error.message || "The photo could not be saved."
    }, 502);
  }
}
