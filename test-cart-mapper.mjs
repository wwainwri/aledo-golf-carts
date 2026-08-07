/* Checks AGCCartFromApi in site.js — the shared mapper the listing
   grid and the single-cart page both draw from.

   Worth its own test because it is an explicit field whitelist: a key
   the API returns but this mapper forgets to copy does not fail
   loudly, it silently falls back to something plausible. That is
   exactly how the cart's own page ended up showing the short blurb
   instead of the full write-up. */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = "C:/Users/willi/OneDrive/Documents/Claude Code/AGC/Aledo Golf Carts";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
};

/* site.js is browser code: it defines the mapper, then runs an IIFE
   that wires up nav and scroll behaviour. Stub just enough of a DOM
   that the IIFE runs without throwing, so the real file is what gets
   tested rather than a copy of the function. */
const noop = () => {};
const fakeEl = {
  addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
  appendChild: noop, style: {}, textContent: "", value: "", dataset: {}
};
const sandbox = {
  console,
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: noop,
    createElement: () => ({ ...fakeEl }),
    body: fakeEl,
    documentElement: fakeEl
  },
  window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), location: { href: "", search: "" } },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  navigator: { userAgent: "node" },
  location: { href: "", search: "", pathname: "/" },
  setTimeout, clearTimeout, fetch: async () => ({ ok: false })
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(readFileSync(`${ROOT}/site.js`, "utf8"), sandbox);

const map = sandbox.AGCCartFromApi;
check("site.js defines AGCCartFromApi", typeof map === "function", typeof map);

/* What /api/inventory actually sends: `description` already
   short-preferring, `longDescription` already long-preferring. */
const both = map({
  id: "rec1", name: "Teko Trophy",
  description: "Short blurb.",
  longDescription: "The full write-up, several sentences long."
});
check("short blurb survives for the listing grid", both.description === "Short blurb.", both.description);
check("long write-up survives for the cart's own page",
  both.longDescription === "The full write-up, several sentences long.", both.longDescription);

/* The regression this test exists for: the cart page renders
   `longDescription || description`. If the mapper drops
   longDescription, that expression silently yields the short blurb on
   the one page that is supposed to show the long one. */
check("cart page's own fallback resolves to the LONG text, not the short",
  (both.longDescription || both.description) === "The full write-up, several sentences long.",
  both.longDescription || both.description);
check("listing grid still resolves to the SHORT text",
  both.description === "Short blurb.", both.description);

/* A cart with only a long description: inventory.mjs already folds
   the fallback in before this mapper sees it, so both arrive equal. */
const longOnly = map({
  id: "rec2", name: "Dach Apollo",
  description: "Only a long one was written.",
  longDescription: "Only a long one was written."
});
check("long-only cart reads the same both places",
  longOnly.description === longOnly.longDescription && longOnly.description.length > 0, longOnly.description);

/* Neither written: empty strings, never undefined, so the render
   guards (`c.description ? ... : ''`) behave. */
const neither = map({ id: "rec3", name: "Bare Cart" });
check("missing descriptions become empty strings, not undefined",
  neither.description === "" && neither.longDescription === "",
  { d: neither.description, l: neither.longDescription });

check("a record with no name is rejected", map({ id: "rec4" }) === null);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
