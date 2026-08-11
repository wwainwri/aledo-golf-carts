/* Deleting a cart is the one write on this endpoint with nothing
   behind it — no undo, no copy, and the sold price goes with the row.
   So the cases that matter are the ones where it must refuse. */

const ROOT = "C:/Users/willi/OneDrive/Documents/Claude Code/AGC/Aledo Golf Carts";
process.env.AIRTABLE_TOKEN = "stub-token";
process.env.OWNER_KEY = "stub-owner-key-long-enough";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
};
const section = (name) => console.log(`\n${name}`);

let calls = [];
let airtableStatus = 200;

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: (init && init.method) || "GET" });
  if (airtableStatus !== 200) {
    return new Response(JSON.stringify({ error: { type: "NOT_FOUND" } }), { status: airtableStatus });
  }
  return new Response(JSON.stringify({ records: [{ id: "recCART1", deleted: true }] }), { status: 200 });
};

const { default: cart } = await import(`file:///${ROOT}/netlify/functions/cart.mjs`);

function ask(method, query, key) {
  calls = [];
  const headers = {};
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  return cart(new Request("https://aledogolfcarts.com/api/cart" + (query || ""), { method, headers }));
}

section("the lock");

let r = await ask("DELETE", "?id=recCART1", null);
check("no owner key -> 401, Airtable never contacted", r.status === 401 && calls.length === 0, r.status + " calls=" + calls.length);

r = await ask("DELETE", "?id=recCART1", "wrong-key-entirely-xx");
check("wrong owner key -> 401, Airtable never contacted", r.status === 401 && calls.length === 0, r.status);

section("what it refuses");

r = await ask("DELETE", "");
let b = await r.json();
check("no id at all is refused", r.status === 400 && calls.length === 0, r.status);
check("refusal explains why", /valid record id/i.test(b.message), b.message);

r = await ask("DELETE", "?id=not-a-record");
check("a malformed id is refused before Airtable is called", r.status === 400 && calls.length === 0, r.status);

/* A blank id must not become a request that deletes something else. */
r = await ask("DELETE", "?id=");
check("an empty id is refused", r.status === 400 && calls.length === 0, r.status);

section("deleting");

r = await ask("DELETE", "?id=recCART1");
b = await r.json();
check("a real id succeeds", r.status === 200 && b.ok === true, r.status);
check("it reports what it did", b.action === "deleted" && b.id === "recCART1", JSON.stringify(b));
check("exactly one Airtable call", calls.length === 1, calls.length);
check("Airtable gets a DELETE, not a PATCH that blanks the row", calls[0].method === "DELETE", calls[0].method);
check("the id travels as a query param, per Airtable's delete API",
  calls[0].url.includes("records%5B%5D=recCART1") || calls[0].url.includes("records[]=recCART1"),
  calls[0].url);

section("when Airtable says no");

airtableStatus = 404;
r = await ask("DELETE", "?id=recGONE1");
b = await r.json();
check("an upstream failure is reported, not swallowed as success",
  r.status === 502 && b.ok === false, r.status + " " + b.ok);
airtableStatus = 200;

section("the other methods still work as before");

r = await ask("PUT", "?id=recCART1");
b = await r.json();
check("an unsupported method is refused", r.status === 405, r.status);
check("and the message now mentions DELETE", /DELETE/.test(b.error), b.error);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
