/* Exercises the Quo phone activity endpoint against a stubbed Quo.

   Run:  node test-quo.mjs

   The cases that matter: it must never answer without the owner key,
   it must survive Quo being partly broken rather than showing an empty
   dashboard, and "unreturned missed call" has to be right — that is
   the one number here that represents money walking away. */

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

const OURS = "+18177762175";
const THEM = "+18175551234";
const OTHER = "+18175559999";

let calls = [];
let routes = {};

globalThis.fetch = async (url, options) => {
  const href = String(url);
  calls.push({ url: href, options });
  for (const [match, value] of Object.entries(routes)) {
    if (href.includes(match)) {
      const out = typeof value === "function" ? value(href) : value;
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200 });
    }
  }
  return new Response(JSON.stringify({ error: "unstubbed" }), { status: 500 });
};

const mod = await import("./netlify/functions/quo.mjs");

function ask(query, key) {
  calls = [];
  const headers = {};
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  return mod.default(new Request("https://aledogolfcarts.com/api/quo" + (query || ""), { headers }));
}

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

function baseRoutes(overrides) {
  return Object.assign({
    "/phone-numbers": { data: [{ id: "PN1", number: OURS, name: "Main line" }] },
    "/conversations": {
      data: [
        { id: "CN1", phoneNumberId: "PN1", participants: [THEM], name: "Dale Brooks", lastActivityAt: iso(5) },
        { id: "CN2", phoneNumberId: "PN1", participants: [OTHER], lastActivityAt: iso(60) }
      ]
    },
    "/messages": { data: [] },
    "/calls": { data: [] }
  }, overrides || {});
}

/* ── 1. the gate ─────────────────────────────────────────── */
section("1. Owner gate");

routes = baseRoutes();
let r = await ask("", null);
check("no owner key -> refused, Quo never contacted",
  r.status === 401 && calls.length === 0, r.status + " calls=" + calls.length);

r = await ask("", "wrong-key");
check("wrong owner key -> refused", r.status === 401, r.status);

/* ── 2. not connected yet ────────────────────────────────── */
section("2. Before QUO_API_KEY is set");

delete process.env.QUO_API_KEY;
r = await ask();
let body = await r.json();
check("answers 200 so the dashboard can explain itself",
  r.status === 200 && body.ok === true, r.status);
check("says it is not configured", body.configured === false, body.configured);
check("did not call Quo", calls.length === 0, calls.length);
check("still returns empty lists rather than undefined",
  Array.isArray(body.activity) && Array.isArray(body.numbers), body);
process.env.QUO_API_KEY = "stub-quo-key";

/* ── 3. the request Quo actually needs ───────────────────── */
section("3. Talking to Quo correctly");

routes = baseRoutes();
r = await ask();
body = await r.json();

check("sends the key raw, with no Bearer prefix",
  calls[0].options.headers.Authorization === "stub-quo-key",
  calls[0].options.headers.Authorization);

const callsQuery = calls.find((c) => c.url.includes("/calls?"));
check("asks /calls with the participants it requires",
  callsQuery && /[?&]participants(\[\])?=/.test(callsQuery.url) &&
  callsQuery.url.includes("phoneNumberId=PN1"), callsQuery && callsQuery.url);
check("tries the spec form of participants first",
  callsQuery && /[?&]participants=/.test(callsQuery.url), callsQuery && callsQuery.url);

const convQuery = calls.find((c) => c.url.includes("/conversations"));
check("asks /conversations with maxResults, which is mandatory",
  convQuery && /maxResults=\d+/.test(convQuery.url), convQuery && convQuery.url);

/* Quo's spec does not say how it wants an array in a query string, and
   the wrong shape would leave this panel permanently, silently empty.
   So a 400 has to make it try the other form. */
routes = baseRoutes({
  "/messages": (href) => /[?&]participants=/.test(href)
    ? new Response(JSON.stringify({ message: "participants is required" }), { status: 400 })
    : (href.includes(encodeURIComponent(THEM))
        ? { data: [{ id: "M9", from: THEM, to: [OURS], text: "hello", direction: "incoming", status: "received", createdAt: iso(3) }] }
        : { data: [] }),
  "/calls": (href) => /[?&]participants=/.test(href)
    ? new Response("bad request", { status: 400 })
    : { data: [] }
});
r = await ask();
body = await r.json();
check("falls back to participants[] when the plain form is rejected",
  body.activity.length === 1 && body.activity[0].id === "M9", body.activity);
/* Having learned it, the next request should lead with the shape that
   worked rather than paying for the rejection again. */
r = await ask();
body = await r.json();
const firstMessages = calls.find((c) => c.url.includes("/messages?"));
check("the working shape is used first next time",
  firstMessages && firstMessages.url.includes("participants%5B%5D=") === false &&
  /participants\[\]=/.test(firstMessages.url), firstMessages && firstMessages.url);
check("and it still returns the activity", body.activity.length === 1, body.activity.length);

/* ── 4. merging into one timeline ────────────────────────── */
section("4. The merged timeline");

routes = baseRoutes({
  "/messages": (href) => href.includes(encodeURIComponent(THEM))
    ? { data: [{ id: "M1", from: THEM, to: [OURS], text: "Is the blue one still there?", direction: "incoming", status: "received", createdAt: iso(4) }] }
    : { data: [] },
  "/calls": (href) => href.includes(encodeURIComponent(THEM))
    ? { data: [{ id: "C1", participants: [OURS, THEM], direction: "incoming", status: "completed", answeredAt: iso(30), duration: 214, createdAt: iso(30) }] }
    : { data: [{ id: "C2", participants: [OURS, OTHER], direction: "incoming", status: "missed", duration: 0, createdAt: iso(60) }] }
});

r = await ask();
body = await r.json();

check("calls and texts land in one list", body.activity.length === 3, body.activity.length);
check("newest first",
  new Date(body.activity[0].at) >= new Date(body.activity[1].at), body.activity.map((a) => a.at));
check("the text is attributed to the customer, not to us",
  body.activity[0].kind === "text" && body.activity[0].direction === "in" &&
  body.activity[0].with === THEM, body.activity[0]);
check("the contact name from the conversation is carried across",
  body.activity[0].withName === "Dale Brooks", body.activity[0].withName);
check("numbers are formatted for reading",
  body.activity[0].withPretty === "(817) 555-1234", body.activity[0].withPretty);
check("an answered call is not marked missed",
  body.activity.find((a) => a.id === "C1").missed === false);
check("a missed call is",
  body.activity.find((a) => a.id === "C2").missed === true);

/* ── 5. unreturned missed calls ──────────────────────────── */
section("5. Unreturned missed calls");

check("a missed call with no callback is flagged",
  body.unreturned.length === 1 && body.unreturned[0].id === "C2",
  body.unreturned.map((u) => u.id));

/* Now ring them back, and it should stop being flagged. */
routes = baseRoutes({
  "/calls": (href) => href.includes(encodeURIComponent(OTHER))
    ? { data: [
        { id: "C2", participants: [OURS, OTHER], direction: "incoming", status: "missed", duration: 0, createdAt: iso(60) },
        { id: "C3", participants: [OURS, OTHER], direction: "outgoing", status: "completed", duration: 90, createdAt: iso(20) }
      ] }
    : { data: [] },
  "/messages": { data: [] }
});
r = await ask();
body = await r.json();
check("ringing them back afterwards clears it", body.unreturned.length === 0, body.unreturned);

/* A text back counts as returning it too. */
routes = baseRoutes({
  "/calls": (href) => href.includes(encodeURIComponent(OTHER))
    ? { data: [{ id: "C2", participants: [OURS, OTHER], direction: "incoming", status: "missed", duration: 0, createdAt: iso(60) }] }
    : { data: [] },
  "/messages": (href) => href.includes(encodeURIComponent(OTHER))
    ? { data: [{ id: "M2", from: OURS, to: [OTHER], text: "Sorry we missed you!", direction: "outgoing", status: "delivered", createdAt: iso(10) }] }
    : { data: [] }
});
r = await ask();
body = await r.json();
check("texting them back also clears it", body.unreturned.length === 0, body.unreturned);

/* A reply BEFORE the missed call must not count. */
routes = baseRoutes({
  "/calls": (href) => href.includes(encodeURIComponent(OTHER))
    ? { data: [{ id: "C2", participants: [OURS, OTHER], direction: "incoming", status: "missed", duration: 0, createdAt: iso(10) }] }
    : { data: [] },
  "/messages": (href) => href.includes(encodeURIComponent(OTHER))
    ? { data: [{ id: "M3", from: OURS, to: [OTHER], text: "earlier chat", direction: "outgoing", status: "delivered", createdAt: iso(600) }] }
    : { data: [] }
});
r = await ask();
body = await r.json();
check("an older outgoing message does not count as returning it",
  body.unreturned.length === 1, body.unreturned);

/* ── 6. Quo misbehaving ──────────────────────────────────── */
section("6. When Quo misbehaves");

routes = baseRoutes({
  "/calls": () => new Response("boom", { status: 500 })
});
r = await ask();
body = await r.json();
check("one broken thread does not empty the whole timeline",
  r.status === 200 && body.ok === true, r.status);

routes = { "/phone-numbers": () => new Response("nope", { status: 401 }) };
r = await ask();
body = await r.json();
check("a rejected API key is reported as such",
  r.status === 502 && /API key/i.test(body.message), body.message);

routes = { "/phone-numbers": () => new Response("slow down", { status: 429 }) };
r = await ask();
body = await r.json();
check("rate limiting is named, not shown as a mystery",
  /rate limit/i.test(body.message), body.message);

routes = { "/phone-numbers": { data: [] } };
r = await ask();
body = await r.json();
check("no phone numbers on the account is handled",
  r.status === 200 && body.activity.length === 0, r.status);

/* ── 7. call summaries ───────────────────────────────────── */
section("7. Sona call summaries");

routes = baseRoutes({
  "/call-summaries/": { data: { status: "completed", summary: ["Asked about the blue Madjax"], nextSteps: ["Send pricing"] } }
});
r = await ask("?callId=AC123");
body = await r.json();
check("a summary comes back", body.ok === true && body.summary.points.length === 1, body.summary);
check("only one request is made for it", calls.length === 1, calls.length);

routes = { "/call-summaries/": () => new Response("none", { status: 404 }) };
r = await ask("?callId=AC123");
body = await r.json();
check("a call with no summary is not an error",
  r.status === 200 && body.summary === null, body);

r = await ask("?callId=../../secrets");
check("a malformed call id is refused", r.status === 400, r.status);

/* ── 8. threads ──────────────────────────────────────────── */
section("8. Grouping into conversation threads");

routes = baseRoutes({
  "/messages": (href) => href.includes(encodeURIComponent(THEM))
    ? { data: [
        { id: "M1", direction: "incoming", from: THEM, text: "Is the blue Madjax still there?", createdAt: iso(5) },
        { id: "M2", direction: "outgoing", to: [THEM], text: "It is — come by today.", createdAt: iso(4) }
      ] }
    : { data: [{ id: "M3", direction: "incoming", from: OTHER, text: "what time do yall close", createdAt: iso(60) }] },
  "/calls": (href) => href.includes(encodeURIComponent(OTHER))
    ? { data: [{ id: "C1", direction: "incoming", participants: [OTHER, OURS], status: "missed", createdAt: iso(55) }] }
    : { data: [] }
});
r = await ask();
body = await r.json();

check("threads come back", Array.isArray(body.threads) && body.threads.length === 2,
  body.threads && body.threads.length);

const dale = body.threads.find((t) => t.with === THEM);
const stranger = body.threads.find((t) => t.with === OTHER);

check("one entry per person, not per message",
  dale && dale.items.length === 2, dale && dale.items.length);
check("the named contact keeps their name", dale && dale.withName === "Dale Brooks",
  dale && dale.withName);
check("newest thread sorts first", body.threads[0].with === THEM, body.threads[0].with);
check("preview is the latest message", dale && dale.preview === "It is — come by today.",
  dale && dale.preview);
check("a missed call previews as one", stranger && stranger.preview === "Missed call",
  stranger && stranger.preview);
check("counts are per thread",
  dale && dale.counts.texts === 2 && dale.counts.calls === 0 &&
  stranger && stranger.counts.missed === 1,
  { dale: dale && dale.counts, stranger: stranger && stranger.counts });

check("an unreturned missed call is flagged on its thread",
  stranger && stranger.unreturned === true, stranger && stranger.unreturned);
check("a thread we answered is not flagged",
  dale && dale.unreturned === false, dale && dale.unreturned);

check("deep link points at that exact Quo thread",
  dale && dale.quoUrl === "https://my.quo.com/inbox/PN1/c/CN1", dale && dale.quoUrl);
check("the flat timeline still exists for the rest of the dashboard",
  Array.isArray(body.activity) && body.activity.length === 4, body.activity && body.activity.length);

/* A thread Quo gave us no conversation id for must still render, and
   must not produce a link that 404s in Quo. */
routes = baseRoutes({
  "/conversations": { data: [{ phoneNumberId: "PN1", participants: [THEM], lastActivityAt: iso(5) }] },
  "/messages": { data: [{ id: "M9", direction: "incoming", from: THEM, text: "hello", createdAt: iso(5) }] }
});
r = await ask();
body = await r.json();
check("a thread with no conversation id still appears",
  body.threads.length === 1, body.threads.length);
check("and falls back to the inbox rather than a broken link",
  body.threads[0].quoUrl === "https://my.quo.com/inbox", body.threads[0].quoUrl);

check("threads are empty, not undefined, before Quo is connected", true);
delete process.env.QUO_API_KEY;
r = await ask();
body = await r.json();
check("  ...confirmed", Array.isArray(body.threads) && body.threads.length === 0, body.threads);
process.env.QUO_API_KEY = "stub-quo-key";

/* ── 9. number matching ──────────────────────────────────── */
section("9. Matching numbers written different ways");

check("+1 E.164 and a dashed local number match",
  mod.numberKey("+18175551234") === mod.numberKey("817-555-1234"));
check("brackets and spaces match too",
  mod.numberKey("(817) 555-1234") === mod.numberKey("8175551234"));
check("different numbers do not match",
  mod.numberKey("+18175551234") !== mod.numberKey("+18175559999"));

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
