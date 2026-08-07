/* Exercises /api/generate-description against a stubbed Gemini. */

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
process.env.GEMINI_API_KEY = "stub-gemini-key";

let calls = [];
let nextGeminiResponse = null;

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (typeof nextGeminiResponse === "function") return nextGeminiResponse();
  return nextGeminiResponse;
};

const mod = await import("./netlify/functions/generate-description.mjs");

function ask(body, key) {
  calls = [];
  const headers = { "Content-Type": "application/json" };
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  return mod.default(new Request("https://aledogolfcarts.com/api/generate-description", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }));
}

function geminiReply(text) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }]
  }), { status: 200 });
}

const CART = { name: "2026 Teko Trophy", year: "2026", seats: "4", type: "New", battery: "Lithium", color: "Slate Gray" };

section("1. Owner gate");
let r = await ask(CART, null);
check("no owner key -> refused, Gemini never contacted", r.status === 401 && calls.length === 0, r.status);

r = await ask(CART, "wrong-key");
check("wrong owner key -> refused", r.status === 401, r.status);

section("2. Before GEMINI_API_KEY is set");
delete process.env.GEMINI_API_KEY;
r = await ask(CART);
let body = await r.json();
check("answers 200 so the dashboard can explain itself", r.status === 200 && body.configured === false, body);
check("did not call Gemini", calls.length === 0, calls.length);
process.env.GEMINI_API_KEY = "stub-gemini-key";

section("3. Validation");
r = await ask({ year: "2026" });
body = await r.json();
check("no name -> refused", r.status === 400 && /name/i.test(body.message), body);
check("Gemini never contacted", calls.length === 0, calls.length);

section("4. A real generation");
nextGeminiResponse = geminiReply(JSON.stringify({
  short: "A clean 2026 Teko Trophy in Slate Gray, ready to go.",
  long: "This 2026 Teko Trophy comes in a sharp Slate Gray finish and seats four. It's brand new and powered by a lithium battery pack. A great fit for anyone wanting a fresh, low-maintenance cart."
}));
r = await ask(CART);
body = await r.json();
check("200 ok", r.status === 200 && body.ok === true, body);
check("short description returned", body.short.includes("Teko Trophy"), body.short);
check("long description returned", body.long.length > body.short.length, body);

const sent = JSON.parse(calls[0].init.body);
const prompt = sent.contents[0].parts[0].text;
check("prompt includes the cart's real facts", prompt.includes("Slate Gray") && prompt.includes("Lithium"), prompt.slice(0, 50));
check("prompt explicitly forbids inventing specs", /do not invent/i.test(prompt), prompt.slice(0, 50));
check("requests JSON response mime type", sent.generationConfig.responseMimeType === "application/json", sent.generationConfig);
check("key sent as query param, not header", calls[0].url.includes("key=stub-gemini-key"), calls[0].url);

section("5. Gemini wraps JSON in a code fence anyway");
nextGeminiResponse = geminiReply('```json\n{"short": "Short one.", "long": "Long one, several sentences here."}\n```');
r = await ask(CART);
body = await r.json();
check("still parses correctly", r.status === 200 && body.short === "Short one.", body);

section("6. When Gemini misbehaves");
nextGeminiResponse = new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 403 });
r = await ask(CART);
body = await r.json();
check("a bad key is named specifically", /api key/i.test(body.message), body.message);

nextGeminiResponse = new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
r = await ask(CART);
body = await r.json();
check("rate limiting is named, not a mystery 502", /rate limit/i.test(body.message), body.message);

nextGeminiResponse = geminiReply("not valid json at all");
r = await ask(CART);
body = await r.json();
check("unparseable text fails cleanly", r.status === 502 && /could not be read/i.test(body.message), body);

nextGeminiResponse = new Response(JSON.stringify({
  candidates: [],
  promptFeedback: { blockReason: "SAFETY" }
}), { status: 200 });
r = await ask(CART);
body = await r.json();
check("a safety-blocked prompt is named specifically", /declined.*SAFETY/i.test(body.message), body.message);

nextGeminiResponse = geminiReply(JSON.stringify({ short: "Only a short one." }));
r = await ask(CART);
body = await r.json();
check("a response missing the long description is refused, not half-accepted",
  r.status === 502 && /both descriptions/i.test(body.message), body);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
