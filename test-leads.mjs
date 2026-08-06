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

let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: (init && init.method) || "GET" });
  if (String(url).includes("/tbl6eydRTXlkvykP6")) {
    if (init && init.method === "DELETE") {
      return new Response(JSON.stringify({ records: [{ id: "recNEW1", deleted: true }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ records }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: "unstubbed" }), { status: 500 });
};

const { default: leads } = await import(`file:///${ROOT}/netlify/functions/leads.mjs`);

function ask(method, query, key) {
  calls = [];
  const headers = {};
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  return leads(new Request("https://aledogolfcarts.com/api/leads" + (query || ""), { method, headers }));
}

const res = await ask("GET");
const body = await res.json();

check("200", res.status === 200, res.status);
check("all three leads returned", body.leads.length === 3, body.leads.length);

const byId = Object.fromEntries(body.leads.map((l) => [l.id, l]));

check("new-style lead reads Request Type directly", byId.recNEW1.type === "Service Request", byId.recNEW1.type);
check("old-style lead's type is sniffed from the [Label] prefix", byId.recOLD1.type === "Cart Inquiry", byId.recOLD1.type);
check("a lead with neither gets an empty type, not a crash", byId.recANCIENT.type === "", byId.recANCIENT.type);

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
