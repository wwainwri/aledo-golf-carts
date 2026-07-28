/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — public inventory endpoint

   Serves the Airtable inventory to the website, the owner
   dashboard, and the Facebook Post Queue as plain JSON.

   Why this exists rather than reading Airtable from the browser:
     1. Airtable has no anonymous read API. A token in front-end
        JavaScript would be readable by anyone — and that token
        would also open the Leads table, which holds real customer
        names, emails, and phone numbers.
     2. Airtable meters API calls. The Free plan allows only 1,000
        a month, and every plan is capped at 5 requests/second per
        base. Letting every visitor hit Airtable directly would burn
        the monthly quota in days. The CDN caches this response, so
        Airtable sees at most one request per CACHE_SECONDS however
        busy the site gets.

   The token lives only in the AIRTABLE_TOKEN environment variable
   (Netlify → Site configuration → Environment variables) and never
   reaches the browser.
   ═══════════════════════════════════════════════════════════ */

import { isOwner } from "../lib/owner-auth.mjs";

export const config = { path: "/api/inventory" };

const API = "https://api.airtable.com/v0";

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblrmWorOHAYtw2pv";
const VIEW_ID = process.env.AIRTABLE_VIEW_ID || "viw2U9mmLUaZhJIiE";

/* How long the CDN may serve this before asking Airtable again — in
   other words, the longest an Airtable edit can take to reach the
   public website.

   Because `stale-while-revalidate` is set below, a visitor never waits
   on Airtable: once this expires the edge serves the old copy instantly
   and refreshes in the background. So the only cost of a shorter window
   is more Airtable API calls.

   Rough upper bounds, assuming steady traffic all day:

        60s  → updates within a minute    (busy sites: watch the quota)
       300s  → updates within 5 minutes
      3600s  → updates within an hour     (kindest to Airtable's Free plan)

   Real traffic is bursty, so actual call counts land well below those
   ceilings. Airtable's Free plan allows 1,000 calls a month; paid plans
   are far higher. Set INVENTORY_CACHE_SECONDS in Netlify to tune it. */
const CACHE_SECONDS = Number(process.env.INVENTORY_CACHE_SECONDS) || 60;

/* Airtable omits empty fields entirely, so every read is defensive. */
function pick(fields, ...names) {
  for (const name of names) {
    if (fields[name] !== undefined && fields[name] !== null) return fields[name];
  }
  return "";
}

/* Photos is a text field of Google Drive links today. If it is ever
   converted to an Airtable attachment field this still works, because
   attachments arrive as an array of objects with a `url`. */
function photoList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (item && item.url) || "").filter(Boolean);
  }
  return String(value || "")
    .split(/[\n,|]+/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));
}

function statusOf(value) {
  const status = String(value || "").trim().toLowerCase();
  if (/^(hide|hidden|draft)/.test(status)) return "hidden";
  if (/pend/.test(status)) return "pending";
  if (/sold/.test(status)) return "sold";
  return "available";
}

function toCart(record, forOwner) {
  /* Tolerate field renames and casing drift in Airtable. */
  const fields = {};
  for (const [key, value] of Object.entries(record.fields || {})) {
    fields[key.trim().toLowerCase()] = value;
  }

  const name = String(pick(fields, "name", "model", "cart", "title")).trim();
  if (!name) return null;

  const price = pick(fields, "price");
  const year = pick(fields, "year");
  const seats = pick(fields, "seats");

  return {
    id: record.id,
    name,
    year: year === "" ? "" : String(year),
    price: price === "" ? "" : String(price),
    seats: seats === "" ? "" : String(seats),
    type: String(pick(fields, "type", "condition")).trim(),
    battery: String(pick(fields, "battery")).trim(),
    color: String(pick(fields, "color", "colour")).trim(),
    description: String(pick(fields, "description", "notes", "details")).trim(),
    photos: photoList(pick(fields, "photos", "photo", "images")),
    status: statusOf(pick(fields, "status")),
    /* A checkbox arrives as true, or is absent entirely when unticked. */
    featured: pick(fields, "featured") === true ||
      /^(y|yes|true|1|x)$/i.test(String(pick(fields, "featured")).trim()),

    /* When the row was created, which the dashboard turns into "days on
       the lot". Deliberately owner-only: how long a cart has been sitting
       is a negotiating position, not something to publish to buyers. */
    created: forOwner ? (record.createdTime || "") : undefined
  };
}

async function fetchAllRecords(token, forOwner) {
  const carts = [];
  let offset;

  /* Airtable pages at 100 records. Ten carts today, but this will not
     silently truncate when the lot grows. */
  do {
    const url = new URL(`${API}/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set("view", VIEW_ID);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      /* Never echo Airtable's body — it can restate the request. */
      const error = new Error(`Airtable responded ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    for (const record of payload.records || []) {
      const cart = toCart(record, forOwner);
      if (cart) carts.push(cart);
    }
    offset = payload.offset;
  } while (offset);

  return carts;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders
    }
  });
}

export default async function handler(request) {
  const token = process.env.AIRTABLE_TOKEN;

  /* The dashboard sends an owner key, and a custom header makes the
     browser ask permission first. */
  if (request.method === "OPTIONS") {
    return json({ ok: true }, 200, {
      "Access-Control-Allow-Headers": "Content-Type, X-Owner-Key",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store"
    });
  }

  /* The owner's own tools — the dashboard and the Post Queue — ask for
     ?fresh=1 and skip the cache entirely. They are looking at inventory
     precisely to check whether an edit landed, so showing them a cached
     copy defeats the point. Public pages get the cached response. */
  const wantsFresh = new URL(request.url).searchParams.has("fresh");

  /* Signed-in owner, on a request that is never cached. Both halves
     matter. Without ?fresh=1 this response can sit on the CDN, and the
     next anonymous visitor would be handed the owner's copy — hidden
     carts and all. Tying the extra data to the uncached path removes
     that possibility rather than relying on getting Vary right. */
  const forOwner = wantsFresh && isOwner(request);

  if (!token) {
    return json(
      { error: "not_configured", message: "AIRTABLE_TOKEN is not set on this site." },
      500,
      { "Cache-Control": "no-store" }
    );
  }

  try {
    const carts = await fetchAllRecords(token, forOwner);

    /* Hidden carts are deliberately kept off the public endpoint. The
       owner marks a cart Hide precisely so nobody outside sees it, and
       this response is readable by anyone. The owner's own dashboard
       does get them, so a hidden cart can be found and un-hidden
       without a trip to Airtable. */
    const visible = forOwner ? carts : carts.filter((cart) => cart.status !== "hidden");

    return json(
      { carts: visible, count: visible.length, owner: forOwner, updated: new Date().toISOString() },
      200,
      {
        "Access-Control-Allow-Headers": "Content-Type, X-Owner-Key",
        /* Fresh for CACHE_SECONDS, then served stale while it refreshes
           in the background so a visitor never waits on Airtable. */
        "Cache-Control": wantsFresh
          ? "no-store"
          : `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`
      }
    );
  } catch (error) {
    return json(
      {
        error: "upstream_error",
        message: error.message || "Could not read inventory.",
        carts: []
      },
      502,
      { "Cache-Control": "no-store" }
    );
  }
}
