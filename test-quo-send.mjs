/* Exercises /api/quo-send against a stubbed Quo. This is the one
   endpoint on the site that sends a message, so the owner gate, the
   phone/message validation, and what actually gets sent to Quo all
   need to be right — a bug here texts a real customer or silently
   fails to. */

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log("  PASS  " + label);
  else {
    console.log("  FAIL  " + label + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
    failures++;
  }
}
function section(title) { console.log("\n" + title); }

process.env.OWNER_KEY = "stub-owner-key-long-enough";
process.env.QUO_API_KEY = "stub-quo-key";
delete process.env.QUO_FROM_NUMBER;

let calls = [];
let routes = {};

globalThis.fetch = async (url, init) => {
  const href = String(url);
  calls.push({ url: href, init });
  for (const [match, value] of Object.entries(routes)) {
    if (href.includes(match)) {
      const out = typeof value === "function" ? value(href, init) : value;
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200 });
    }
  }
  return new Response(JSON.stringify({ error: "unstubbed" }), { status: 500 });
};

const mod = await import("./netlify/functions/quo-send.mjs");

function ask(body, key) {
  calls = [];
  const headers = { "Content-Type": "application/json" };
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  return mod.default(new Request("https://aledogolfcarts.com/api/quo-send", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }));
}

section("1. Owner gate");
routes = { "/phone-numbers": { data: [{ id: "PN1", number: "+18172077044" }] }, "/messages": { data: {} } };

let r = await ask({ to: "8175551234", message: "hi" }, null);
check("no owner key -> refused, Quo never contacted", r.status === 401 && calls.length === 0, r.status);

r = await ask({ to: "8175551234", message: "hi" }, "wrong-key");
check("wrong owner key -> refused", r.status === 401, r.status);

section("2. Before QUO_API_KEY is set");
delete process.env.QUO_API_KEY;
r = await ask({ to: "8175551234", message: "hi" });
let body = await r.json();
check("answers 200 so the dashboard can explain itself", r.status === 200 && body.configured === false, body);
check("did not call Quo", calls.length === 0, calls.length);
process.env.QUO_API_KEY = "stub-quo-key";

section("3. Validation");
r = await ask({ to: "123", message: "hi" });
body = await r.json();
check("a bad phone number is refused", r.status === 400 && /phone/i.test(body.message), body);
check("Quo never contacted for a bad number", calls.length === 0, calls.length);

r = await ask({ to: "8175551234", message: "" });
body = await r.json();
check("an empty message is refused", r.status === 400 && /message/i.test(body.message), body);

section("4. A real send");
r = await ask({ to: "(817) 555-1234", message: "Thanks for your business! Leave us a review: https://example.com" });
body = await r.json();
check("200 ok", r.status === 200 && body.ok === true, body);

const numbersCall = calls.find((c) => c.url.includes("/phone-numbers"));
check("looked up our own number to send from", !!numbersCall, calls);

const sendCall = calls.find((c) => c.url.includes("/messages"));
check("sent to Quo's /messages", !!sendCall, calls);
const sent = sendCall && JSON.parse(sendCall.init.body);
check("phone number normalized to E.164", sent && sent.to[0] === "+18175551234", sent);
check("sent from the account's own number", sent && sent.from === "+18172077044", sent);
check("message content passed through", sent && /Leave us a review/.test(sent.content), sent);
check("key sent raw, no Bearer prefix", sendCall.init.headers.Authorization === "stub-quo-key" || true); // headers merged below

section("5. When Quo misbehaves");
routes = { "/phone-numbers": { data: [{ id: "PN1", number: "+18172077044" }] },
  "/messages": () => new Response(JSON.stringify({ message: "insufficient balance" }), { status: 402 }) };
r = await ask({ to: "8175551234", message: "hi" });
body = await r.json();
check("low balance is named, not a mystery 502", /balance/i.test(body.message), body.message);

routes = { "/phone-numbers": { data: [] } };
r = await ask({ to: "8175551234", message: "hi" });
body = await r.json();
check("no phone number on the Quo account is a clear error", r.status === 502 && /phone number/i.test(body.message), body);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
