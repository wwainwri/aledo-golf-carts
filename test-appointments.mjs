/* Checks the calendar's endpoint: what it stores, what it refuses,
   and what it says when the Airtable table does not exist yet. */

const ROOT = "C:/Users/willi/OneDrive/Documents/Claude Code/AGC/Aledo Golf Carts";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.OWNER_KEY = "stub-owner-key-long-enough";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};
const section = (name) => console.log(`\n${name}`);

const records = [
  {
    id: "recLATER",
    fields: { Title: "Deliver the Onward", Date: "2026-08-20", Time: "14:00", Type: "Delivery", Customer: "Dana Whitfield", Status: "Scheduled" }
  },
  {
    id: "recSOON",
    fields: { Title: "Service drop-off", Date: "2026-08-12", Time: "09:00", Type: "Service", Customer: "Sam Ortiz", Status: "Scheduled" }
  },
  {
    /* Typed straight into Airtable with no date. Must not sort to the
       front just because "" compares low. */
    id: "recNODATE",
    fields: { Title: "Someday", Type: "Other" }
  },
  {
    id: "recSAMEDAY",
    fields: { Title: "Test drive", Date: "2026-08-12", Time: "08:00", Type: "Test drive", Status: "Scheduled" }
  }
];

/* Flipped per-test to exercise the missing-table path. `missingStatus`
   picks which way Airtable refuses: 404 for a base-scoped token, 403
   for one scoped to named tables. Both mean the same thing to us. */
let tableExists = true;
let missingStatus = 404;
let calls = [];

globalThis.fetch = async (url, init) => {
  const method = (init && init.method) || "GET";
  calls.push({ url: String(url), method, body: init && init.body ? JSON.parse(init.body) : null });

  if (!String(url).includes("Appointments")) {
    return new Response(JSON.stringify({ error: "unstubbed" }), { status: 500 });
  }
  if (!tableExists) {
    return new Response(
      JSON.stringify({ error: { type: missingStatus === 403 ? "NOT_AUTHORIZED" : "TABLE_NOT_FOUND" } }),
      { status: missingStatus }
    );
  }
  if (method === "GET") return new Response(JSON.stringify({ records }), { status: 200 });
  if (method === "DELETE") return new Response(JSON.stringify({ records: [{ id: "recSOON", deleted: true }] }), { status: 200 });

  /* POST/PATCH echo back what Airtable would have stored. */
  const sent = JSON.parse(init.body).records[0];
  return new Response(JSON.stringify({
    records: [{ id: sent.id || "recNEW", fields: sent.fields }]
  }), { status: 200 });
};

const { default: appointments } = await import(`file:///${ROOT}/netlify/functions/appointments.mjs`);

function ask(method, { query = "", body, key } = {}) {
  calls = [];
  const headers = {};
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  if (body) headers["Content-Type"] = "application/json";
  return appointments(new Request("https://aledogolfcarts.com/api/appointments" + query, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  }));
}

/* ── the lock ─────────────────────────────────────────────── */
section("owner gate");

let r = await ask("GET", { key: null });
check("no owner key -> 401, Airtable never contacted", r.status === 401 && calls.length === 0, r.status + " calls=" + calls.length);

r = await ask("GET", { key: "wrong-key-entirely-here" });
check("wrong owner key -> 401", r.status === 401, r.status);

/* ── listing ──────────────────────────────────────────────── */
section("GET");

r = await ask("GET");
let b = await r.json();
check("200", r.status === 200, r.status);
check("all four returned", b.appointments.length === 4, b.appointments.length);
check("soonest first", b.appointments[0].id === "recSAMEDAY", b.appointments.map((a) => a.id).join(","));
check("same day orders by time", b.appointments[1].id === "recSOON", b.appointments[1].id);
check("later date comes after", b.appointments[2].id === "recLATER", b.appointments[2].id);
check("an undated row sorts last, not first", b.appointments[3].id === "recNODATE", b.appointments[3].id);
check("fields map through", b.appointments[1].customer === "Sam Ortiz", b.appointments[1].customer);
check("a missing Status reads as Scheduled", b.appointments[3].status === "Scheduled", b.appointments[3].status);

/* ── creating ─────────────────────────────────────────────── */
section("POST");

r = await ask("POST", { body: { title: "Test drive — Rivera", date: "2026-08-14", time: "10:30", type: "Test drive", customer: "Jo Rivera", phone: "817-555-0100" } });
b = await r.json();
check("201-ish ok", r.status === 200 && b.ok === true, r.status);
check("action is created", b.action === "created", b.action);
check("Airtable got a POST", calls[0].method === "POST", calls[0].method);
check("title stored", calls[0].body.records[0].fields.Title === "Test drive — Rivera");
check("date stored", calls[0].body.records[0].fields.Date === "2026-08-14");
check("time stored", calls[0].body.records[0].fields.Time === "10:30");
check("typecast on, so a new select option is allowed", calls[0].body.typecast === true);

r = await ask("POST", { body: { title: "No date given" } });
b = await r.json();
check("a create with no date is refused", r.status === 400, r.status);
check("refusal names the problem", /date is required/i.test(b.message), b.message);

r = await ask("POST", { body: { date: "2026-08-14" } });
b = await r.json();
check("a create with no title is refused", r.status === 400 && /title is required/i.test(b.message), b.message);

r = await ask("POST", { body: { title: "Bad date", date: "14/08/2026" } });
check("a non-ISO date is refused", r.status === 400, r.status);

r = await ask("POST", { body: { title: "Bad time", date: "2026-08-14", time: "25:99" } });
b = await r.json();
check("an impossible time is refused", r.status === 400 && /HH:MM/i.test(b.message), b.message);

r = await ask("POST", { body: { title: "Blank time is fine", date: "2026-08-14", time: "" } });
check("an empty time is allowed — not every appointment has one", r.status === 200, r.status);

r = await ask("POST", { body: { title: "Odd type", date: "2026-08-14", type: "Marriage" } });
check("an unknown type falls back to Other rather than erroring",
  calls[0].body.records[0].fields.Type === "Other", calls[0].body.records[0].fields.Type);

r = await ask("POST", { body: { title: "Defaults", date: "2026-08-14" } });
check("a bare create still gets Type", calls[0].body.records[0].fields.Type === "Other");
check("a bare create still gets Status", calls[0].body.records[0].fields.Status === "Scheduled");

r = await ask("POST", { body: { title: "Case insensitive", date: "2026-08-14", type: "test DRIVE" } });
check("type matching ignores case", calls[0].body.records[0].fields.Type === "Test drive", calls[0].body.records[0].fields.Type);

/* ── updating ─────────────────────────────────────────────── */
section("PATCH");

r = await ask("PATCH", { body: { id: "recSOON", status: "Done" } });
b = await r.json();
check("ok", r.status === 200 && b.action === "updated", r.status + " " + b.action);
check("Airtable got a PATCH", calls[0].method === "PATCH", calls[0].method);
check("only the field sent is written",
  Object.keys(calls[0].body.records[0].fields).join(",") === "Status",
  Object.keys(calls[0].body.records[0].fields).join(","));

r = await ask("PATCH", { body: { status: "Done" } });
check("a patch with no id is refused", r.status === 400, r.status);

r = await ask("PATCH", { body: { id: "not-an-id", status: "Done" } });
check("a malformed id is refused before Airtable is called", r.status === 400 && calls.length === 0, r.status);

r = await ask("PATCH", { body: { id: "recSOON" } });
b = await r.json();
check("a patch that changes nothing is refused", r.status === 400 && /nothing to change/i.test(b.message), b.message);

r = await ask("PATCH", { body: { id: "recSOON", date: "not-a-date" } });
check("a patch with a bad date is refused", r.status === 400, r.status);

/* A PATCH must not be forced to resend title and date just to move a
   status — that was the point of `partial`. */
r = await ask("PATCH", { body: { id: "recSOON", time: "11:00" } });
check("time alone can be patched without resending title/date", r.status === 200, r.status);

/* ── deleting ─────────────────────────────────────────────── */
section("DELETE");

r = await ask("DELETE", { query: "?id=recSOON" });
b = await r.json();
check("ok", r.status === 200 && b.ok === true, r.status);
check("id echoed back", b.id === "recSOON", b.id);
check("Airtable got a DELETE", calls[0].method === "DELETE", calls[0].method);
check("id travels as a query param",
  calls[0].url.includes("records%5B%5D=recSOON") || calls[0].url.includes("records[]=recSOON"),
  calls[0].url);

r = await ask("DELETE", { query: "?id=nope" });
check("a malformed id is refused, Airtable untouched", r.status === 400 && calls.length === 0, r.status);

/* ── the table does not exist yet ─────────────────────────── */
section("before the Airtable table is created");
tableExists = false;

r = await ask("GET");
b = await r.json();
check("listing says setup_required, not a scary 502", r.status === 200 && b.error === "setup_required", r.status + " " + b.error);
check("the message tells the owner what to make", /Appointments/.test(b.message) && /Title/.test(b.message), b.message);

r = await ask("POST", { body: { title: "Anything", date: "2026-08-14" } });
b = await r.json();
check("creating says setup_required too", b.error === "setup_required", b.error);

check("the reply names what Airtable actually said, so a scope problem is not mislabelled",
  b.airtableSaid === "TABLE_NOT_FOUND", b.airtableSaid);

/* A 404 on a request that carried a record id means that record is
   gone, not that the table is missing — those must not be conflated. */
r = await ask("DELETE", { query: "?id=recGONE" });
b = await r.json();
check("a 404 on a real record id is an upstream error, not setup advice",
  r.status === 502 && b.error === "upstream_error", r.status + " " + b.error);

/* A token scoped to named tables reports a table it cannot see as 403,
   not 404. Same situation for the owner, so it must read the same. */
missingStatus = 403;
r = await ask("GET");
b = await r.json();
check("a 403 on the table is treated as setup_required too", b.error === "setup_required", b.error);
check("and says so was a permissions answer", b.airtableSaid === "NOT_AUTHORIZED", b.airtableSaid);
check("the message mentions checking the token's access", /AIRTABLE_TOKEN/.test(b.message), b.message);

missingStatus = 404;
tableExists = true;

/* ── method guard ─────────────────────────────────────────── */
section("guards");
r = await ask("PUT", { body: { title: "x" } });
check("an unsupported method is refused", r.status === 405, r.status);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
