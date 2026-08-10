/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — appointments (owner only)

   The calendar in the owner dashboard. Test drives, service
   drop-offs, deliveries, pickups, callbacks — anything with a date
   the owner needs to remember.

   Owner-gated for the same reason /api/leads is: an appointment
   carries a customer's name and phone number.

   GET    /api/appointments            list them, soonest first
   POST   /api/appointments            create one
   PATCH  /api/appointments            update one
   DELETE /api/appointments?id=recX    remove one

   ── The table may not exist yet ──
   Unlike Inventory and Leads, this table is new, so the base very
   likely does not have it the first time this is called. Airtable
   answers 404 for a table it cannot find, and this turns that one
   status into a `setup_required` reply rather than a generic
   failure — the dashboard shows the owner how to create the table
   instead of an "Airtable is down" message that would be a lie.

   Environment variables:
     AIRTABLE_TOKEN   read + write on the Aledo base
     OWNER_KEY        your passphrase, same one the dashboard uses
   ═══════════════════════════════════════════════════════════ */

import { json, checkOwner, airtable } from "../lib/owner-auth.mjs";

export const config = { path: "/api/appointments" };

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
/* Addressed by name, not by a tblXXX id — the owner is going to create
   this table by hand, and they can name a table but cannot choose its
   id. Airtable resolves a URL-encoded table name just as happily. */
const TABLE = process.env.AIRTABLE_APPOINTMENTS_TABLE || "Appointments";

const TYPES = ["Test drive", "Service", "Delivery", "Pickup", "Follow-up", "Other"];
const STATUSES = ["Scheduled", "Done", "Cancelled"];

const MAX = 400;

function str(value) {
  return value == null ? "" : String(value).trim();
}

/** YYYY-MM-DD only. Anything else is a bug or someone poking about. */
function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(value + "T00:00:00Z").getTime());
}

/* Stored as text in 24-hour form rather than folded into an Airtable
   datetime. A cart is dropped off at 9am Aledo time whatever timezone
   the browser reading this happens to be in, and a date-plus-text-time
   pair cannot drift the way a UTC timestamp silently does. */
function isTime(value) {
  return value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function oneOf(list, value, fallback) {
  const found = list.find((item) => item.toLowerCase() === str(value).toLowerCase());
  return found || fallback;
}

function toAppointment(record) {
  const f = record.fields || {};
  return {
    id: record.id,
    title: str(f.Title),
    date: str(f.Date).slice(0, 10),
    time: str(f.Time),
    type: str(f.Type) || "Other",
    customer: str(f.Customer),
    phone: str(f.Phone),
    cart: str(f.Cart),
    notes: str(f.Notes),
    status: str(f.Status) || "Scheduled",
    /* Set when the appointment was created from a website lead, so the
       dashboard can avoid drawing the request and the confirmed
       appointment as two separate things on the same day. */
    leadId: str(f["Lead ID"])
  };
}

/** Only the fields a caller may write. Anything else is ignored. */
function fieldsFrom(input, { partial }) {
  const fields = {};

  if (input.title !== undefined || !partial) {
    const title = str(input.title);
    if (!title) throw new Error("A title is required.");
    fields.Title = title.slice(0, 200);
  }

  if (input.date !== undefined || !partial) {
    const date = str(input.date);
    if (!isDate(date)) throw new Error("A date is required, as YYYY-MM-DD.");
    fields.Date = date;
  }

  if (input.time !== undefined) {
    const time = str(input.time);
    if (!isTime(time)) throw new Error("Time must be 24-hour HH:MM, or empty.");
    fields.Time = time;
  }

  if (input.type !== undefined) fields.Type = oneOf(TYPES, input.type, "Other");
  if (input.status !== undefined) fields.Status = oneOf(STATUSES, input.status, "Scheduled");
  if (input.customer !== undefined) fields.Customer = str(input.customer).slice(0, 200);
  if (input.phone !== undefined) fields.Phone = str(input.phone).slice(0, 60);
  if (input.cart !== undefined) fields.Cart = str(input.cart).slice(0, 200);
  if (input.notes !== undefined) fields.Notes = str(input.notes).slice(0, 4000);
  if (input.leadId !== undefined) fields["Lead ID"] = str(input.leadId).slice(0, 40);

  /* A new appointment nobody has typed a type or status for is a
     Scheduled Other, not a record with two blank single-selects. */
  if (!partial) {
    if (fields.Type === undefined) fields.Type = "Other";
    if (fields.Status === undefined) fields.Status = "Scheduled";
  }

  return fields;
}

async function listAppointments() {
  const out = [];
  let offset = "";

  do {
    const query = new URLSearchParams({ pageSize: "100" });
    if (offset) query.set("offset", offset);

    const page = await airtable("GET", `${BASE_ID}/${encodeURIComponent(TABLE)}?${query}`);
    for (const record of page.records || []) out.push(toAppointment(record));

    offset = page.offset || "";
  } while (offset && out.length < MAX);

  /* Soonest first. A calendar is read forwards, and the dashboard's
     "what's next" list wants the top of this array. Undated records
     (someone typed a row straight into Airtable and left Date empty)
     sort last rather than jumping to the front as empty strings. */
  out.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return (a.date + a.time).localeCompare(b.date + b.time);
  });

  return out.slice(0, MAX);
}

/* Airtable says 404 both for "no such table" and for "no such record".
   The difference matters: one needs setup instructions, the other is
   an id that no longer exists. A record id is only ever in play when
   we sent one, so the caller tells us which case it is in. */
function isMissingTable(error, sentRecordId) {
  return error.status === 404 && !sentRecordId;
}

function setupReply() {
  return json({
    ok: false,
    error: "setup_required",
    message:
      "No Appointments table found in Airtable yet. Create a table named " +
      "\"Appointments\" with these fields: Title (text), Date (date), Time (text), " +
      "Type (single select), Customer (text), Phone (text), Cart (text), " +
      "Notes (long text), Status (single select), Lead ID (text)."
  }, 200);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);

  const denied = checkOwner(request);
  if (denied) return denied;

  let sentRecordId = "";

  try {
    if (request.method === "GET") {
      const appointments = await listAppointments();
      return json({ ok: true, appointments, count: appointments.length }, 200);
    }

    if (request.method === "POST" || request.method === "PATCH") {
      let input;
      try {
        input = await request.json();
      } catch {
        return json({ ok: false, error: "invalid", message: "Could not read the request." }, 400);
      }

      const partial = request.method === "PATCH";
      if (partial) {
        sentRecordId = str(input.id);
        if (!/^rec[A-Za-z0-9]+$/.test(sentRecordId)) {
          return json({ ok: false, error: "invalid", message: "A valid appointment id is required." }, 400);
        }
      }

      let fields;
      try {
        fields = fieldsFrom(input, { partial });
      } catch (error) {
        return json({ ok: false, error: "invalid", message: error.message }, 400);
      }

      if (partial && !Object.keys(fields).length) {
        return json({ ok: false, error: "invalid", message: "Nothing to change." }, 400);
      }

      /* typecast lets a select option that isn't in the table yet be
         created on write, so the owner never has to pre-fill Type and
         Status by hand before the calendar will save. */
      const body = partial
        ? { records: [{ id: sentRecordId, fields }], typecast: true }
        : { records: [{ fields }], typecast: true };

      const result = await airtable(
        partial ? "PATCH" : "POST",
        `${BASE_ID}/${encodeURIComponent(TABLE)}`,
        body
      );

      const record = (result.records || [])[0];
      return json({
        ok: true,
        appointment: record ? toAppointment(record) : null,
        action: partial ? "updated" : "created"
      }, 200);
    }

    if (request.method === "DELETE") {
      sentRecordId = str(new URL(request.url).searchParams.get("id"));
      if (!/^rec[A-Za-z0-9]+$/.test(sentRecordId)) {
        return json({ ok: false, error: "invalid", message: "A valid appointment id is required." }, 400);
      }

      await airtable("DELETE",
        `${BASE_ID}/${encodeURIComponent(TABLE)}?records[]=${encodeURIComponent(sentRecordId)}`);

      return json({ ok: true, id: sentRecordId }, 200);
    }

    return json({
      ok: false,
      error: "GET to list, POST to add, PATCH to change one, DELETE to remove one."
    }, 405);
  } catch (error) {
    if (isMissingTable(error, sentRecordId)) return setupReply();
    return json({
      ok: false,
      error: "upstream_error",
      message: error.message || "Could not reach Airtable."
    }, 502);
  }
}
