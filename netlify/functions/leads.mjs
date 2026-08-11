/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — leads endpoint (owner only)

   Lets the owner dashboard show website enquiries without anyone
   having to open Airtable.

   ── This one is the sensitive endpoint ──
   Inventory is public information; leads are not. Every record here
   holds a real person's name, email, phone number, and their texting
   consent. So unlike /api/inventory, this:

     • requires the owner key on every request
     • refuses everything if OWNER_KEY was never set
     • is never cached, at the CDN or in the browser
     • returns only the fields the dashboard actually shows

   GET   /api/leads          list recent leads, newest first
   PATCH /api/leads          update one lead's Status

   Environment variables:
     AIRTABLE_TOKEN   read + write on the Aledo base
     OWNER_KEY        your passphrase, same one the dashboard uses
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner, airtable } from "../lib/owner-auth.mjs";

export const config = { path: "/api/leads" };

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const LEADS_TABLE = process.env.AIRTABLE_LEADS_TABLE || "tbl6eydRTXlkvykP6";

/* The only status values the dashboard may set. Anything else is a
   typo or someone poking at the endpoint. */
const STATUSES = ["New", "Contacted", "Qualified", "Unqualified", "Converted"];

/* Where a repair actually is, which the sales pipeline above cannot
   say — "Qualified" tells you nothing about a cart sitting in the shop.
   The two that matter most are the two that strand a job: waiting on a
   part that hasn't arrived, and finished work nobody has collected. */
const SERVICE_STATUSES = [
  "New",
  "Scheduled",
  "In progress",
  "Waiting on parts",
  "Ready for pickup",
  "Collected",
  "Cancelled"
];

const MAX_LEADS = 200;

function str(value) {
  return value == null ? "" : String(value).trim();
}

/* Every lead written before the Request Type field existed still has
   its type as a "[Label]" prefix on Inquiry Details — lead.mjs has
   always written that, for a human reading Airtable directly. Reusing
   it here means those older leads pick up a badge too, with nothing
   to backfill by hand. */
function typeFromDetails(details) {
  const match = /^\[([^\]]+)\]/.exec(details);
  return match ? match[1] : "";
}

/** Airtable omits empty fields, so read defensively. */
function toLead(record) {
  const f = record.fields || {};
  return {
    id: record.id,
    name: str(f["Full Name"]),
    email: str(f["Email Address"]),
    phone: str(f["Phone Number"]),
    details: str(f["Inquiry Details"]),
    /* Falls back to sniffing the [Label] prefix already inside Inquiry
       Details, so leads written before this field existed still get a
       type instead of showing up unlabeled. */
    type: str(f["Request Type"]) || typeFromDetails(str(f["Inquiry Details"])),
    date: str(f["Submission Date"]) || str(record.createdTime).slice(0, 10),
    createdTime: record.createdTime || "",
    source: str(f["Lead Source"]),
    status: str(f["Status"]) || "New",
    cart: str(f["Cart Interest"]),
    consent: str(f["TCPA Consent"]),
    page: str(f["Page"]),
    /* Both are optional columns the owner adds when they want them.
       Absent reads as empty, never as an error — a base without them
       behaves exactly as it did before they existed. */
    serviceStatus: str(f["Service Status"]),
    notes: str(f["Owner Notes"])
  };
}

async function listLeads() {
  const leads = [];
  let offset = "";

  do {
    const query = new URLSearchParams({ pageSize: "100" });
    if (offset) query.set("offset", offset);

    const page = await airtable("GET", `${BASE_ID}/${LEADS_TABLE}?${query}`);
    for (const record of page.records || []) leads.push(toLead(record));

    offset = page.offset || "";
  } while (offset && leads.length < MAX_LEADS);

  /* Newest first. Airtable's own view order is whatever the owner last
     dragged it into, which is not what you want in an inbox. */
  leads.sort((a, b) => {
    const left = a.createdTime || a.date;
    const right = b.createdTime || b.date;
    return right.localeCompare(left);
  });

  return leads.slice(0, MAX_LEADS);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  try {
    if (request.method === "GET") {
      const leads = await listLeads();
      const open = leads.filter((lead) => lead.status === "New").length;
      /* Shipped with the data so the dashboard's dropdown and this
         endpoint's validation cannot drift apart. */
      return json({
        ok: true, leads, count: leads.length, open,
        statuses: STATUSES,
        serviceStatuses: SERVICE_STATUSES
      }, 200);
    }

    if (request.method === "PATCH") {
      let input;
      try {
        input = await request.json();
      } catch {
        return json({ ok: false, error: "Could not read the request." }, 400);
      }

      const id = str(input.id);
      if (!/^rec[A-Za-z0-9]+$/.test(id)) {
        return json({ ok: false, error: "invalid", message: "A valid lead id is required." }, 400);
      }

      /* Three separately-writable things, because they move at
         different times: the sales status when you speak to someone,
         the service status as the job progresses, and notes whenever
         you learn something. A PATCH may carry any one of them. */
      const fields = {};

      if (input.status !== undefined) {
        const status = STATUSES.find((s) => s.toLowerCase() === str(input.status).toLowerCase());
        if (!status) {
          return json({
            ok: false,
            error: "invalid",
            message: `Status must be one of: ${STATUSES.join(", ")}.`
          }, 400);
        }
        fields.Status = status;
      }

      if (input.serviceStatus !== undefined) {
        const wanted = str(input.serviceStatus);
        /* Empty clears it — a lead wrongly marked as a service job
           needs a way back to being an ordinary enquiry. */
        if (wanted === "") {
          fields["Service Status"] = "";
        } else {
          const found = SERVICE_STATUSES.find((s) => s.toLowerCase() === wanted.toLowerCase());
          if (!found) {
            return json({
              ok: false,
              error: "invalid",
              message: `Service status must be one of: ${SERVICE_STATUSES.join(", ")}.`
            }, 400);
          }
          fields["Service Status"] = found;
        }
      }

      if (input.notes !== undefined) {
        fields["Owner Notes"] = str(input.notes).slice(0, 4000);
      }

      if (!Object.keys(fields).length) {
        return json({ ok: false, error: "invalid", message: "Nothing to change." }, 400);
      }

      try {
        await airtable("PATCH", `${BASE_ID}/${LEADS_TABLE}`, {
          records: [{ id, fields }],
          typecast: true
        });
      } catch (error) {
        /* Service Status and Owner Notes are columns the owner has to
           add. Airtable rejects the whole write with 422 if one is
           missing, which would otherwise surface as a blank failure on
           a field the owner has never heard of. */
        const missing = error.status === 422 &&
          (fields["Service Status"] !== undefined || fields["Owner Notes"] !== undefined);
        if (missing) {
          return json({
            ok: false,
            error: "setup_required",
            message:
              "Add these two columns to the Leads table in Airtable first: " +
              "\"Service Status\" (single select, leave the options empty) and " +
              "\"Owner Notes\" (long text). Everything else on this lead still works without them."
          }, 200);
        }
        throw error;
      }

      return json({
        ok: true,
        id,
        status: fields.Status,
        serviceStatus: fields["Service Status"],
        notes: fields["Owner Notes"]
      }, 200);
    }

    if (request.method === "DELETE") {
      const id = str(new URL(request.url).searchParams.get("id"));
      if (!/^rec[A-Za-z0-9]+$/.test(id)) {
        return json({ ok: false, error: "invalid", message: "A valid lead id is required." }, 400);
      }

      /* Airtable takes the record to delete as a query param, not a
         body — the one write in this file that isn't JSON in, JSON
         out. There is no undo once this succeeds; the dashboard is
         the thing standing between a stray click and a lost lead. */
      await airtable("DELETE", `${BASE_ID}/${LEADS_TABLE}?records[]=${encodeURIComponent(id)}`);

      return json({ ok: true, id }, 200);
    }

    return json({ ok: false, error: "GET to list leads, PATCH to update one, DELETE to remove one." }, 405);
  } catch (error) {
    return json({
      ok: false,
      error: "upstream_error",
      message: error.message || "Could not reach Airtable."
    }, 502);
  }
}
