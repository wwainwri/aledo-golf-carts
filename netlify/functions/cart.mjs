/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — inventory write endpoint

   Lets the owner dashboard edit Airtable directly instead of
   bouncing the owner into Airtable's own interface.

   ── Why this is locked ──
   A Netlify function is a public URL. Without a gate, anyone who
   found this address could rewrite your prices or mark the lot
   sold. So every request must carry the owner key:

       X-Owner-Key: <the value of OWNER_KEY>

   Set OWNER_KEY yourself in Netlify → Site configuration →
   Environment variables. Make it long and random; you will paste
   it into the dashboard once and your browser remembers it.

   If OWNER_KEY is not set, this endpoint refuses everything. It
   fails closed on purpose — an unset variable must never mean
   "let everybody in".

   ── What it will and will not touch ──
   Only the inventory fields below can be written. The Leads table
   is unreachable from here, so a stolen key exposes no customer
   data and cannot touch a single lead.

   Environment variables:
     AIRTABLE_TOKEN   read + write on the Aledo base
     OWNER_KEY        your own passphrase for this endpoint
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner, airtable as airtableFetch } from "../lib/owner-auth.mjs";

export const config = { path: "/api/cart" };

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblrmWorOHAYtw2pv";

/* The only fields this endpoint may write, and how to clean each one.
   Anything else in the request body is ignored rather than rejected,
   so a future dashboard version can send extra keys harmlessly. */
const WRITABLE = {
  Name: (v) => text(v, 200),
  Year: (v) => wholeNumber(v, 1900, 2100),
  Price: (v) => wholeNumber(v, 0, 10000000),
  /* What the cart cost to buy. Writable so it can be entered from the
     dashboard, but it is never returned to a public caller — see the
     owner gate in inventory.mjs. */
  Cost: (v) => wholeNumber(v, 0, 10000000),
  Seats: (v) => wholeNumber(v, 1, 12),
  Type: (v) => oneOf(v, ["New", "Used"]),
  Battery: (v) => text(v, 60),
  Color: (v) => text(v, 60),
  Description: (v) => text(v, 2000),
  Photos: (v) => text(v, 4000),
  /* The uploaded photo gallery. Uploading is a separate endpoint —
     Airtable takes file bytes at a different host — so all this does is
     reorder and delete, by sending back the ids to keep, in the order
     to keep them. An empty array clears the gallery. */
  Gallery: (v) => attachmentIds(v),
  Status: (v) => oneOf(v, ["Available", "Pending", "Sold", "Hide"]),
  Featured: (v) => v === true || v === "true" || v === 1
};

function text(value, max) {
  const cleaned = String(value == null ? "" : value).trim().slice(0, max);
  return cleaned === "" ? null : cleaned; /* null clears the cell */
}

/* Airtable rewrites an attachment field to exactly the list it is
   given, so the order sent is the order stored and anything left out is
   deleted. Only ids are accepted — never a URL — because a URL here
   would let anyone holding the owner key make this site fetch an
   arbitrary address and store the result. */
function attachmentIds(value) {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) throw new Error("Gallery must be a list of photos.");
  if (value.length > 30) throw new Error("A cart can hold at most 30 photos.");

  return value.map((item) => {
    const id = typeof item === "string" ? item : (item && item.id);
    if (!/^att[A-Za-z0-9]{10,20}$/.test(String(id || ""))) {
      throw new Error("Each photo must be given by its id.");
    }
    return { id: String(id) };
  });
}

function wholeNumber(value, min, max) {
  if (value === "" || value == null) return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) throw new Error("Value out of range.");
  return rounded;
}

function oneOf(value, allowed) {
  const cleaned = String(value == null ? "" : value).trim();
  if (cleaned === "") return null;
  const match = allowed.find((a) => a.toLowerCase() === cleaned.toLowerCase());
  if (!match) throw new Error(`Expected one of: ${allowed.join(", ")}.`);
  return match;
}

function buildFields(input) {
  const fields = {};
  let touched = 0;

  for (const [name, clean] of Object.entries(WRITABLE)) {
    if (!Object.prototype.hasOwnProperty.call(input, name)) continue;
    fields[name] = clean(input[name]);
    touched++;
  }

  if (!touched) throw new Error("No editable fields were supplied.");
  return fields;
}

function airtable(method, body) {
  return airtableFetch(method, `${BASE_ID}/${TABLE_ID}`, body);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  if (request.method !== "PATCH" && request.method !== "POST") {
    return json({ ok: false, error: "PATCH to edit a cart, POST to add one." }, 405);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the request." }, 400);
  }

  let fields;
  try {
    fields = buildFields(input.fields || {});
  } catch (error) {
    return json({ ok: false, error: "invalid", message: error.message }, 400);
  }

  try {
    if (request.method === "POST") {
      if (!fields.Name) {
        return json({ ok: false, error: "invalid", message: "A new cart needs a name." }, 400);
      }
      const created = await airtable("POST", { records: [{ fields }], typecast: true });
      return json({ ok: true, id: created.records[0].id, action: "created" }, 200);
    }

    const id = String(input.id || "").trim();
    if (!/^rec[A-Za-z0-9]+$/.test(id)) {
      return json({ ok: false, error: "invalid", message: "A valid record id is required." }, 400);
    }

    const updated = await airtable("PATCH", {
      records: [{ id, fields }],
      typecast: true
    });
    return json({ ok: true, id: updated.records[0].id, action: "updated" }, 200);
  } catch (error) {
    return json({
      ok: false,
      error: "upstream_error",
      message: error.message || "Airtable rejected the change."
    }, 502);
  }
}
