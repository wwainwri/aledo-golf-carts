/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — one-off: Drive links → Gallery attachments

   TEMPORARY. Delete this file once the inventory reports zero carts
   left to migrate — there is a line in the log that says so.

   ── What it does ──
   Cart photos used to be Google Drive links pasted into a text column
   called Photos. They are now files in the Gallery attachment field.
   This moves the stragglers: for every cart that still has a Drive
   link and no uploaded photos, it hands Airtable the image URL and
   lets Airtable fetch and store it as a real attachment.

   ── Why it is a scheduled function ──
   It needs write access to Airtable, which means AIRTABLE_TOKEN, which
   only exists server-side. Exposing an HTTP endpoint that rewrites
   photo fields — even briefly, even gated — is a worse idea than
   letting Netlify call this on a timer and then deleting it.

   Nothing here takes input from a caller. Every URL it fetches comes
   out of our own Airtable record, so there is no way to point it at
   somewhere else.

   ── Why it is safe to run twice ──
   It only touches carts whose Gallery is empty, and it never clears or
   overwrites anything. Run it ten times and the tenth run does nothing.
   ═══════════════════════════════════════════════════════════ */

export const config = {
  /* Every five minutes, so it lands soon after deploy without waiting
     on an hourly tick. It is idempotent, so the repeats are harmless. */
  schedule: "*/5 * * * *"
};

const API = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblrmWorOHAYtw2pv";
const GALLERY_FIELD = process.env.AIRTABLE_GALLERY_FIELD || "Gallery";

/* A Drive share link is a viewer page, not an image. This is the form
   that returns actual image bytes, and the size the website wants — the
   same conversion inventory.js has always done to display them. */
function driveImageUrl(link) {
  const match = String(link || "").match(/\/d\/([A-Za-z0-9_-]+)/) ||
    String(link || "").match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w2000`;
}

function slug(value) {
  return String(value || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "cart";
}

async function airtable(method, path, body) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error(`Airtable responded ${response.status} to ${method} ${path}`);
  }
  return response.json();
}

export default async function handler() {
  if (!process.env.AIRTABLE_TOKEN) {
    console.log("migrate-photos: AIRTABLE_TOKEN is not set; nothing done.");
    return;
  }

  let records = [];
  let offset;

  do {
    const url = new URL(`${API}/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
    });
    if (!response.ok) {
      console.log(`migrate-photos: could not read the table (${response.status}).`);
      return;
    }
    const payload = await response.json();
    records = records.concat(payload.records || []);
    offset = payload.offset;
  } while (offset);

  const pending = records.filter((record) => {
    const fields = record.fields || {};
    const gallery = fields[GALLERY_FIELD];
    if (Array.isArray(gallery) && gallery.length) return false;   /* already done */
    return Boolean(driveImageUrl(fields.Photos));
  });

  if (!pending.length) {
    console.log("migrate-photos: nothing left to migrate. This function can be deleted.");
    return;
  }

  console.log(`migrate-photos: ${pending.length} cart(s) to move.`);

  let moved = 0;
  for (const record of pending) {
    const fields = record.fields || {};
    const url = driveImageUrl(fields.Photos);
    const name = [fields.Year, fields.Name, fields.Color].filter(Boolean).join(" ");

    try {
      /* Airtable fetches the URL itself and stores the bytes, so the
         result is a real attachment rather than another link that can
         rot when someone changes Drive sharing. */
      await airtable("PATCH", `${BASE_ID}/${TABLE_ID}`, {
        records: [{
          id: record.id,
          fields: { [GALLERY_FIELD]: [{ url, filename: `${slug(name)}.jpg` }] }
        }]
      });
      moved++;
      console.log(`migrate-photos: moved ${name}`);
    } catch (error) {
      /* One bad Drive link should not stop the other nine. */
      console.log(`migrate-photos: FAILED ${name} — ${error.message}`);
    }

    /* Airtable allows 5 requests a second per base. */
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`migrate-photos: moved ${moved} of ${pending.length}.`);
}
