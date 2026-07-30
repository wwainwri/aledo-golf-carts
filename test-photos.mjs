/* Exercises the cart photo endpoints against a stubbed Airtable.

   Run:  node test-photos.mjs

   These three functions decide what the public website shows, what
   URLs the outside world is handed, and what an owner key is allowed
   to make this site do — so the cases that matter most are the ones
   where they must refuse or must not leak. */

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log("  PASS  " + label);
  else {
    console.log("  FAIL  " + label + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
    failures++;
  }
}
function section(title) { console.log("\n" + title); }

/* ── the stubbed world ───────────────────────────────────── */

process.env.AIRTABLE_TOKEN = "stub-token";
process.env.OWNER_KEY = "stub-owner-key-long-enough";
process.env.SITE_ORIGIN = "https://aledogolfcarts.com";

const REC = "recAAAAAAAAAAAAAA";
const ATT = "attBBBBBBBBBBBBBB";
const ATT2 = "attCCCCCCCCCCCCCC";

let calls = [];
const responses = new Map();

function stubResponse(match, value) { responses.set(match, value); }

globalThis.fetch = async (url, options) => {
  const href = String(url);
  calls.push({ url: href, options });
  for (const [match, value] of responses) {
    if (href.includes(match)) return value(href, options);
  }
  return new Response("not stubbed", { status: 500 });
};

function airtableRecord(gallery) {
  return new Response(JSON.stringify({ id: REC, fields: { Gallery: gallery } }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

const photoMod = await import("./netlify/functions/photo.mjs");
const uploadMod = await import("./netlify/functions/photo-upload.mjs");
const cartMod = await import("./netlify/functions/cart.mjs");
const inventoryMod = await import("./netlify/functions/inventory.mjs");

const IMAGE = {
  id: ATT, type: "image/jpeg", width: 1600, height: 1200,
  url: "https://v5.airtableusercontent.com/full/expires-in-2-hours",
  thumbnails: { large: { url: "https://v5.airtableusercontent.com/large/expires" } }
};

/* ── 1. the photo proxy ──────────────────────────────────── */
section("1. Photo proxy");

function photoCall(recordId, attachmentId, query) {
  calls = [];
  return photoMod.default(
    new Request(`https://aledogolfcarts.com/api/photo/${recordId}/${attachmentId}${query || ""}`),
    { params: { recordId, attachmentId } }
  );
}

stubResponse("api.airtable.com", () => airtableRecord([IMAGE]));
stubResponse("airtableusercontent.com", () =>
  new Response("JPEGBYTES", { status: 200 }));

let r = await photoCall(REC, ATT);
check("serves the photo", r.status === 200, r.status);
check("keeps the image content type", r.headers.get("Content-Type") === "image/jpeg");
check("cached for a year, immutable",
  /max-age=31536000/.test(r.headers.get("Cache-Control")) &&
  /immutable/.test(r.headers.get("Cache-Control")), r.headers.get("Cache-Control"));
check("fetched the full-size original",
  calls.some((c) => c.url.includes("/full/")), calls.map((c) => c.url));

await photoCall(REC, ATT, "?s=card");
check("?s=card fetches the thumbnail instead",
  calls.some((c) => c.url.includes("/large/")), calls.map((c) => c.url));

r = await photoCall("not-a-record", ATT);
check("rejects a malformed record id without calling Airtable",
  r.status === 400 && calls.length === 0, r.status + " calls=" + calls.length);

r = await photoCall(REC, "https://evil.example/x");
check("cannot be turned into an open proxy", r.status === 400, r.status);

stubResponse("api.airtable.com", () => airtableRecord([]));
r = await photoCall(REC, ATT);
check("404 when the photo has been deleted", r.status === 404, r.status);

stubResponse("api.airtable.com", () =>
  airtableRecord([{ id: ATT, type: "application/pdf", url: "https://v5.airtableusercontent.com/full/x" }]));
r = await photoCall(REC, ATT);
check("refuses a non-image attachment", r.status === 415, r.status);

/* ── 2. upload ───────────────────────────────────────────── */
section("2. Photo upload");

const ONE_PIXEL = Buffer.from("x".repeat(120)).toString("base64");

function uploadCall(body, key) {
  calls = [];
  const headers = { "Content-Type": "application/json" };
  if (key !== null) headers["X-Owner-Key"] = key || process.env.OWNER_KEY;
  return uploadMod.default(new Request("https://aledogolfcarts.com/api/photo-upload", {
    method: "POST", headers, body: JSON.stringify(body)
  }));
}

stubResponse("content.airtable.com", () =>
  new Response(JSON.stringify({ id: REC, fields: { fldXXXX: [IMAGE, IMAGE] } }), { status: 200 }));

r = await uploadCall({ id: REC, contentType: "image/jpeg", data: ONE_PIXEL, filename: "front.jpg" });
let body = await r.json();
check("accepts a good upload", r.status === 200 && body.ok === true, body);
check("reports the new photo count", body.count === 2, body.count);
check("posted to Airtable's content host and the Gallery field",
  calls[0] && calls[0].url.includes("content.airtable.com") && calls[0].url.includes("/Gallery/uploadAttachment"),
  calls[0] && calls[0].url);

r = await uploadCall({ id: REC, contentType: "image/jpeg", data: ONE_PIXEL }, null);
check("no owner key -> refused, nothing sent",
  r.status === 401 && calls.length === 0, r.status + " calls=" + calls.length);

r = await uploadCall({ id: REC, contentType: "image/jpeg", data: ONE_PIXEL }, "wrong-key");
check("wrong owner key -> refused", r.status === 401, r.status);

r = await uploadCall({ id: REC, contentType: "text/html", data: ONE_PIXEL });
check("refuses a non-image content type", r.status === 400 && calls.length === 0, r.status);

r = await uploadCall({ id: REC, contentType: "image/svg+xml", data: ONE_PIXEL });
check("refuses SVG, which can carry script", r.status === 400, r.status);

r = await uploadCall({ id: "recEvil; DROP", contentType: "image/jpeg", data: ONE_PIXEL });
check("refuses a malformed cart id", r.status === 400 && calls.length === 0, r.status);

r = await uploadCall({
  id: REC, contentType: "image/jpeg",
  data: "A".repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3))
});
check("refuses an oversized photo before sending it on",
  r.status === 413 && calls.length === 0, r.status + " calls=" + calls.length);

/* A data: prefix is what a FileReader produces; it must not be stored. */
r = await uploadCall({
  id: REC, contentType: "image/jpeg", data: "data:image/jpeg;base64," + ONE_PIXEL
});
check("strips a data: URL prefix", r.status === 200, r.status);
check("did not store the prefix",
  !JSON.parse(calls[0].options.body).file.startsWith("data:"),
  JSON.parse(calls[0].options.body).file.slice(0, 20));

r = await uploadCall({
  id: REC, contentType: "image/jpeg", data: ONE_PIXEL, filename: "../../etc/passwd"
});
check("strips path separators out of the filename",
  !JSON.parse(calls[0].options.body).filename.includes("/"),
  JSON.parse(calls[0].options.body).filename);

/* ── 3. reorder and delete via /api/cart ─────────────────── */
section("3. Reorder and delete");

function cartCallWith(fields, extra) {
  calls = [];
  return cartMod.default(new Request("https://aledogolfcarts.com/api/cart", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Owner-Key": process.env.OWNER_KEY },
    body: JSON.stringify(Object.assign({ id: REC, fields }, extra || {}))
  }));
}
function cartCall(fields) { return cartCallWith(fields, null); }

/* The guard reads the record before writing, so the write is no longer
   the first call. */
function written() {
  const patch = calls.find((c) => c.options && c.options.method === "PATCH");
  return patch ? JSON.parse(patch.options.body) : null;
}

stubResponse("api.airtable.com", () =>
  new Response(JSON.stringify({ records: [{ id: REC }] }), { status: 200 }));

r = await cartCall({ Gallery: [{ id: ATT2 }, { id: ATT }] });
check("accepts a reorder", r.status === 200, r.status);
check("sends the ids in the order given",
  JSON.stringify(written().records[0].fields.Gallery) ===
  JSON.stringify([{ id: ATT2 }, { id: ATT }]),
  written().records[0].fields.Gallery);

r = await cartCall({ Gallery: [] });
check("an empty list clears the gallery",
  r.status === 200 &&
  written().records[0].fields.Gallery.length === 0, r.status);

r = await cartCall({ Gallery: [{ url: "https://evil.example/payload.jpg" }] });
body = await r.json();
check("refuses a URL — it will not fetch an arbitrary address",
  r.status === 400 && calls.length === 0, r.status);

r = await cartCall({ Gallery: new Array(31).fill({ id: ATT }) });
check("caps the gallery at 30 photos", r.status === 400, r.status);

/* ── 3b. a shorter list must be deliberate ───────────────

   Writing Gallery replaces the field, so anything left out is deleted
   and cannot be recovered. A truncated list is both the most damaging
   thing this endpoint can be sent and the easiest to send by accident.
   Photos did once disappear from a live cart with no explanation, so
   this is the belt to that braces. */
section("3b. Refusing to delete photos by accident");

/* Airtable currently holds three. */
stubResponse("api.airtable.com", (href, options) =>
  (options && options.method === "GET") || !options
    ? new Response(JSON.stringify({ id: REC, fields: { Gallery: [{ id: ATT }, { id: ATT2 }, { id: "attDDDDDDDDDDDDDD" }] } }), { status: 200 })
    : new Response(JSON.stringify({ records: [{ id: REC }] }), { status: 200 }));

r = await cartCall({ Gallery: [{ id: ATT }] });
body = await r.json();
check("a shorter list is refused", r.status === 409, r.status);
check("and says how many it would have deleted", /2 photos/.test(body.message), body.message);
check("nothing was written",
  !calls.some((c) => c.options && c.options.method === "PATCH"),
  calls.map((c) => c.options && c.options.method));

r = await cartCallWith({ Gallery: [{ id: ATT }] }, { allowPhotoRemoval: true });
check("a real delete, which says so, goes through", r.status === 200, r.status);

r = await cartCall({ Gallery: [{ id: ATT2 }, { id: ATT }, { id: "attDDDDDDDDDDDDDD" }] });
check("a reorder of the same photos is untouched by the guard", r.status === 200, r.status);

r = await cartCall({ Gallery: [{ id: ATT }, { id: ATT2 }, { id: "attDDDDDDDDDDDDDD" }, { id: "attEEEEEEEEEEEEEE" }] });
check("a longer list is fine too", r.status === 200, r.status);

/* If we cannot read what is there, we cannot say the write is safe. */
stubResponse("api.airtable.com", (href, options) =>
  (options && options.method === "GET") || !options
    ? new Response("nope", { status: 500 })
    : new Response(JSON.stringify({ records: [{ id: REC }] }), { status: 200 }));
r = await cartCall({ Gallery: [{ id: ATT }] });
check("refuses when it cannot check what is already there", r.status === 502, r.status);

/* Back to the plain stub for anything after this. */
stubResponse("api.airtable.com", () =>
  new Response(JSON.stringify({ records: [{ id: REC }] }), { status: 200 }));

/* ── 4. what the website is handed ───────────────────────── */
section("4. Inventory output");

function inventoryWith(fields) {
  calls = [];
  stubResponse("api.airtable.com", () =>
    new Response(JSON.stringify({ records: [{ id: REC, createdTime: "2026-01-01T00:00:00Z", fields }] }), { status: 200 }));
  return inventoryMod.default(new Request("https://aledogolfcarts.com/api/inventory"));
}

r = await inventoryWith({ Name: "Madjax Ascent", Gallery: [IMAGE], Status: "Available" });
body = await r.json();
let cart = body.carts[0];
check("gallery photo becomes a URL on our own domain",
  cart.photos[0] === `https://aledogolfcarts.com/api/photo/${REC}/${ATT}`, cart.photos[0]);
check("no expiring Airtable URL is ever handed out",
  !JSON.stringify(body).includes("airtableusercontent"), "leaked");
check("card thumbnail offered separately",
  cart.gallery[0].card.endsWith("?s=card"), cart.gallery[0].card);

/* A small original must NOT be routed through Airtable's thumbnail:
   measured live, a 480px source came back re-encoded at 47KB against
   the original's 39KB, so the "optimisation" cost 20% more bytes. */
r = await inventoryWith({
  Name: "Small photo", Status: "Available",
  Gallery: [{ ...IMAGE, width: 480, height: 360 }]
});
body = await r.json();
check("a small photo skips the thumbnail and serves the original",
  !body.carts[0].gallery[0].card.includes("s=card"), body.carts[0].gallery[0].card);
check("intrinsic size travels with the photo",
  cart.gallery[0].width === 1600 && cart.gallery[0].height === 1200, cart.gallery[0]);

r = await inventoryWith({
  Name: "Old Cart", Status: "Available",
  Photos: "https://drive.google.com/file/d/abc/view"
});
body = await r.json();
cart = body.carts[0];
check("a cart still on Drive links keeps working",
  cart.photos[0].includes("drive.google.com"), cart.photos[0]);
check("its gallery is empty, so callers know to fall back",
  Array.isArray(cart.gallery) && cart.gallery.length === 0, cart.gallery);

r = await inventoryWith({
  Name: "Both", Status: "Available", Gallery: [IMAGE],
  Photos: "https://drive.google.com/file/d/abc/view"
});
body = await r.json();
check("uploaded photos win over a leftover Drive link",
  body.carts[0].photos.length === 1 && body.carts[0].photos[0].includes("/api/photo/"),
  body.carts[0].photos);

r = await inventoryWith({
  Name: "Docs", Status: "Available",
  Gallery: [{ id: ATT, type: "application/pdf", url: "https://x/y" }]
});
body = await r.json();
check("a PDF in the gallery is not shown as a photo",
  body.carts[0].photos.length === 0, body.carts[0].photos);

r = await inventoryWith({ Name: "Hidden", Status: "Hide", Gallery: [IMAGE] });
body = await r.json();
check("hidden carts still never reach the public endpoint",
  body.carts.length === 0, body.carts);

r = await inventoryWith({ Name: "Priced", Status: "Available", Cost: 4200, Gallery: [IMAGE] });
body = await r.json();
check("cost is still owner-only",
  body.carts[0].cost === undefined && !JSON.stringify(body).includes("4200"), body.carts[0]);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
