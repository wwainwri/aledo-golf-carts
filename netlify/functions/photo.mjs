/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — cart photo proxy

   Serves one photo from the Gallery attachment field, by record id
   and attachment id:

       /api/photo/recXXXXXXXXXXXXXX/attYYYYYYYYYYYYYY
       /api/photo/recXXXXXXXXXXXXXX/attYYYYYYYYYYYYYY?s=card

   ── Why this exists ──
   Airtable's own attachment URLs EXPIRE, currently after about two
   hours. They are fine to fetch server-side, but they must never be
   the address the outside world holds, because plenty of things hold
   an image URL for far longer than two hours:

       • Google, for the schema.org product images
       • Facebook and iMessage, for og:image link previews
       • a Marketplace listing the owner pasted a link into
       • any visitor's browser cache, or a corporate proxy

   All of those would silently rot. So the public URL is this one —
   permanent, ours, and made only of two Airtable record ids — and the
   expiring URL stays server-side where it belongs.

   ── Why it is cheap ──
   The response is immutable and cached for a year, so the CDN answers
   almost every request without touching this function at all. Airtable
   sees roughly one call per photo, ever, which matters on a plan that
   meters API calls.

   Attachment ids change whenever the owner replaces a photo, so a new
   photo is a new URL. That is what makes a year-long cache safe: there
   is no such thing as a stale hit.
   ═══════════════════════════════════════════════════════════ */

export const config = { path: "/api/photo/:recordId/:attachmentId" };

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblrmWorOHAYtw2pv";

/* The field the owner uploads into. */
const GALLERY_FIELD = process.env.AIRTABLE_GALLERY_FIELD || "Gallery";

/* A year. Safe because the URL contains the attachment id: replace a
   photo and the address changes with it. */
const A_YEAR = 31536000;

/* Only ever serve real pictures. An Airtable attachment field will
   happily hold a PDF or a .mov, and this endpoint's response is
   embedded in the public website — so anything that is not an image
   is refused rather than passed through to a visitor's browser. */
const IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"
]);

/* Airtable ids are opaque but well formed. Checking them here means a
   junk path is rejected before it costs an API call, and there is no
   way to bend this endpoint into a general-purpose URL fetcher. */
const REC = /^rec[A-Za-z0-9]{10,20}$/;
const ATT = /^att[A-Za-z0-9]{10,20}$/;

function fail(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      /* Briefly cacheable so a hammered bad URL does not become a
         hammered Airtable account, but short enough that a genuine
         fix shows up quickly. */
      "Cache-Control": "public, max-age=60"
    }
  });
}

export default async function handler(request, context) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return fail(503, "Not configured.");

  const { recordId, attachmentId } = context.params || {};

  if (!REC.test(String(recordId || "")) || !ATT.test(String(attachmentId || ""))) {
    return fail(400, "Bad photo address.");
  }

  /* `card` asks for Airtable's own ~512px thumbnail, which is what the
     inventory grid needs. Anything else gets the full image, which the
     lightbox uses. */
  const wantsCard = new URL(request.url).searchParams.get("s") === "card";

  let record;
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.status === 404) return fail(404, "No such cart.");
    if (!response.ok) return fail(502, "Could not read the photo.");
    record = await response.json();
  } catch {
    return fail(502, "Could not read the photo.");
  }

  const gallery = (record.fields || {})[GALLERY_FIELD];
  const attachment = Array.isArray(gallery)
    ? gallery.find((item) => item && item.id === attachmentId)
    : null;

  /* Not finding it is the normal outcome for an old URL whose photo has
     since been deleted or replaced, so this is a plain 404 rather than
     an error. */
  if (!attachment) return fail(404, "That photo is no longer on this cart.");

  const type = String(attachment.type || "").toLowerCase();
  if (!IMAGE_TYPES.has(type)) return fail(415, "That attachment is not an image.");

  const thumbnail = wantsCard && attachment.thumbnails && attachment.thumbnails.large;
  const source = (thumbnail && thumbnail.url) || attachment.url;
  if (!source) return fail(404, "That photo is no longer on this cart.");

  let upstream;
  try {
    upstream = await fetch(source);
  } catch {
    return fail(502, "Could not fetch the photo.");
  }

  /* An expired or withdrawn Airtable URL lands here. Not cacheable for
     a year — the next request should try again with a fresh URL. */
  if (!upstream.ok) return fail(502, "Could not fetch the photo.");

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": `public, max-age=${A_YEAR}, immutable`,
      "Access-Control-Allow-Origin": "*",
      /* Airtable's own caching headers describe a URL that expires in
         two hours. Ours does not, so they must not be inherited. */
      "X-Content-Type-Options": "nosniff"
    }
  });
}
