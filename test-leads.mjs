/* Checks what the owner dashboard actually receives from /api/leads,
   including the older leads written before Request Type existed. */

const ROOT = "C:/Users/willi/OneDrive/Documents/Claude Code/AGC/Aledo Golf Carts";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.OWNER_KEY = "stub-owner-key-long-enough";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

const records = [
  {
    id: "recNEW1",
    createdTime: "2026-08-05T12:00:00.000Z",
    fields: {
      "Full Name": "Dana Whitfield",
      "Request Type": "Service Request",
      "Inquiry Details": "[Service Request]\n\nWon't hold a charge.",
      "Status": "New"
    }
  },
  {
    /* Written before the Request Type field existed — only the
       bracketed label inside Inquiry Details says what it was. */
    id: "recOLD1",
    createdTime: "2026-07-20T09:00:00.000Z",
    fields: {
      "Full Name": "Cary Thompson",
      "Inquiry Details": "[Cart Inquiry] Cart: 2026 Mad Jax",
      "Status": "New"
    }
  },
  {
    /* No brackets at all — predates even that convention. Must not
       crash, and should just come back with no type. */
    id: "recANCIENT",
    createdTime: "2026-06-01T09:00:00.000Z",
    fields: {
      "Full Name": "Whoever",
      "Inquiry Details": "Called about a cart.",
      "Status": "New"
    }
  }
];

/* Flipped on to prove the "those columns don't exist yet" path. */
let fieldsMissing = false;
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({
    url: String(url),
    method: (init && init.method) || "GET",
    body: init && init.body ? JSON.parse(init.body) : null
  });
  if (String(url).includes("/tbl6eydRTXlkvykP6")) {
    if (init && init.method === "DELETE") {
      return new Response(JSON.stringify({ records: [{ id: "recNEW1", deleted: true }] }), { status: 200 });
    }
    if (init && init.method === "PATCH") {
      if (fieldsMissing) {
        return new Response(JSON.stringify({
          error: { type: "UNKNOWN_FIELD_NAME", message: "Unknown field name: \"Service Status\"" }
        }), { status: 422 });
      }
      return new Response(JSON.stringify({ records: [JSON.parse(init.body).records[0]] }), { status: 200 });
    }
    return new Response(JSON.stringify({ records }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: "unstubbed" }), { status: 500 });
};

const { default: leads } = await import(`file:///${ROOT}/netlify/functions/leads.mjs`);

function ask(method, query, key, body) {
  calls = [];
  const headers = {};
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  if (body) headers["Content-Type"] = "application/json";
  return leads(new Request("https://aledogolfcarts.com/api/leads" + (query || ""), {
    method, headers, body: body ? JSON.stringify(body) : undefined
  }));
}
const patch = (body) => ask("PATCH", "", undefined, body);

const res = await ask("GET");
const body = await res.json();

check("200", res.status === 200, res.status);
check("all three leads returned", body.leads.length === 3, body.leads.length);

const byId = Object.fromEntries(body.leads.map((l) => [l.id, l]));

check("new-style lead reads Request Type directly", byId.recNEW1.type === "Service Request", byId.recNEW1.type);
check("old-style lead's type is sniffed from the [Label] prefix", byId.recOLD1.type === "Cart Inquiry", byId.recOLD1.type);
check("a lead with neither gets an empty type, not a crash", byId.recANCIENT.type === "", byId.recANCIENT.type);

check("the status lists ship with the data so the dropdown cannot drift",
  body.serviceStatuses.includes("Waiting on parts") && body.statuses.includes("Converted"),
  JSON.stringify(body.serviceStatuses));
check("service status and notes read back, empty when the columns are absent",
  byId.recNEW1.serviceStatus === "" && byId.recNEW1.notes === "",
  byId.recNEW1.serviceStatus + "/" + byId.recNEW1.notes);

/* ── service status and notes ────────────────────────────── */
console.log("\nPATCH /api/leads — service status & notes");

let r2 = await patch({ id: "recNEW1", serviceStatus: "Waiting on parts" });
let b2 = await r2.json();
check("a service status is accepted", r2.status === 200 && b2.ok === true, r2.status);
check("it writes the Service Status column",
  calls[0].body.records[0].fields["Service Status"] === "Waiting on parts",
  JSON.stringify(calls[0].body.records[0].fields));
check("and does not touch Status", calls[0].body.records[0].fields.Status === undefined);

r2 = await patch({ id: "recNEW1", serviceStatus: "waiting ON parts" });
check("service status matching ignores case",
  calls[0].body.records[0].fields["Service Status"] === "Waiting on parts",
  calls[0].body.records[0].fields["Service Status"]);

r2 = await patch({ id: "recNEW1", serviceStatus: "Fixing it" });
b2 = await r2.json();
check("an invented service status is refused", r2.status === 400, r2.status);
check("refusal lists the real ones", /Ready for pickup/.test(b2.message), b2.message);

r2 = await patch({ id: "recNEW1", serviceStatus: "" });
check("an empty service status clears it, for a lead wrongly marked as a job",
  r2.status === 200 && calls[0].body.records[0].fields["Service Status"] === "",
  JSON.stringify(calls[0] && calls[0].body.records[0].fields));

r2 = await patch({ id: "recNEW1", notes: "Ordered the controller, 3-5 days." });
check("notes are written to Owner Notes",
  calls[0].body.records[0].fields["Owner Notes"] === "Ordered the controller, 3-5 days.",
  JSON.stringify(calls[0].body.records[0].fields));

r2 = await patch({ id: "recNEW1", notes: "x".repeat(5000) });
check("very long notes are trimmed rather than rejected",
  calls[0].body.records[0].fields["Owner Notes"].length === 4000,
  calls[0].body.records[0].fields["Owner Notes"].length);

r2 = await patch({ id: "recNEW1", status: "Contacted", serviceStatus: "Scheduled", notes: "Both at once" });
check("all three can move in one write",
  Object.keys(calls[0].body.records[0].fields).sort().join(",") === "Owner Notes,Service Status,Status",
  Object.keys(calls[0].body.records[0].fields).join(","));

r2 = await patch({ id: "recNEW1" });
b2 = await r2.json();
check("a patch that changes nothing is refused", r2.status === 400 && /nothing to change/i.test(b2.message), b2.message);

r2 = await patch({ id: "recNEW1", status: "Napping" });
check("a bad sales status is still refused", r2.status === 400, r2.status);

/* The two new columns are the owner's to add. Until they do, saying so
   beats a blank failure about a field they have never heard of. */
fieldsMissing = true;
r2 = await patch({ id: "recNEW1", serviceStatus: "Scheduled" });
b2 = await r2.json();
check("a missing column reports setup_required, not a bare 502",
  r2.status === 200 && b2.error === "setup_required", r2.status + " " + b2.error);
check("and names both columns to add",
  /Service Status/.test(b2.message) && /Owner Notes/.test(b2.message), b2.message);

/* A plain status change must not be dragged into that advice — that
   column has always existed, so a 422 there is a real problem. */
r2 = await patch({ id: "recNEW1", status: "Contacted" });
check("a 422 on a plain status change stays an error", r2.status === 502, r2.status);
fieldsMissing = false;

/* ── deleting a lead ─────────────────────────────────────── */
console.log("\nDELETE /api/leads");

let r = await ask("DELETE", "", null);
check("no owner key -> refused, Airtable never contacted", r.status === 401 && calls.length === 0, r.status + " calls=" + calls.length);

r = await ask("DELETE", "?id=not-a-real-id");
let b = await r.json();
check("a malformed id is refused", r.status === 400 && calls.length === 0, r.status);
check("refusal explains why", /valid lead id/i.test(b.message), b.message);

r = await ask("DELETE", "?id=recNEW1");
b = await r.json();
check("a real id succeeds", r.status === 200 && b.ok === true, r.status);
check("the id it deleted is echoed back", b.id === "recNEW1", b.id);
check("Airtable gets a DELETE, not a POST or PATCH",
  calls.length === 1 && calls[0].method === "DELETE", calls);
check("the record id travels as a query param, per Airtable's delete API",
  calls[0].url.includes("records%5B%5D=recNEW1") || calls[0].url.includes("records[]=recNEW1"),
  calls[0].url);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
