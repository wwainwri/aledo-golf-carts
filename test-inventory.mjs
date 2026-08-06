/* Checks the short/long description fallback in /api/inventory —
   the part most likely to quietly do the wrong thing: a cart with
   only one of the two fields, or neither, must still make sense on
   both the card grid and its own page. */

const ROOT = "C:/Users/willi/OneDrive/Documents/Claude Code/AGC/Aledo Golf Carts";
process.env.AIRTABLE_TOKEN = "test-token";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

function record(id, fields) {
  return { id, createdTime: "2026-08-01T00:00:00.000Z", fields };
}

const records = [
  record("recBOTH", {
    Name: "Has both", Status: "Available",
    "Description": "The long write-up, several sentences of detail about this exact cart.",
    "Short Description": "The short card blurb."
  }),
  record("recLONGONLY", {
    Name: "Long only", Status: "Available",
    "Description": "Only a long description was ever written for this one."
  }),
  record("recSHORTONLY", {
    Name: "Short only", Status: "Available",
    "Short Description": "Only a short blurb exists here."
  }),
  record("recNEITHER", {
    Name: "Neither", Status: "Available"
  })
];

globalThis.fetch = async () => new Response(JSON.stringify({ records }), { status: 200 });

const { default: inventory } = await import(`file:///${ROOT}/netlify/functions/inventory.mjs`);

const res = await inventory(new Request("https://aledogolfcarts.com/api/inventory"));
const body = await res.json();
const byId = Object.fromEntries(body.carts.map((c) => [c.id, c]));

check("200", res.status === 200, res.status);
check("all four carts returned", body.carts.length === 4, body.carts.length);

check("both: card view uses the short one", byId.recBOTH.description === "The short card blurb.", byId.recBOTH.description);
check("both: cart page uses the long one", byId.recBOTH.longDescription.startsWith("The long write-up"), byId.recBOTH.longDescription);
check("both: raw shortDescription is exactly the short cell, unmerged", byId.recBOTH.shortDescription === "The short card blurb.");
check("both: raw descriptionRaw is exactly the long cell, unmerged",
  byId.recBOTH.descriptionRaw.startsWith("The long write-up"), byId.recBOTH.descriptionRaw);

check("long only: card view falls back to the long one", byId.recLONGONLY.description.startsWith("Only a long description"), byId.recLONGONLY.description);
check("long only: cart page also gets the long one", byId.recLONGONLY.longDescription.startsWith("Only a long description"));
check("long only: raw shortDescription stays empty, not borrowed from long",
  byId.recLONGONLY.shortDescription === "", JSON.stringify(byId.recLONGONLY.shortDescription));

check("short only: raw descriptionRaw stays empty, not borrowed from short — this is the bug that " +
  "would have pre-filled the wrong text into the edit form's Long Description box",
  byId.recSHORTONLY.descriptionRaw === "", JSON.stringify(byId.recSHORTONLY.descriptionRaw));

check("short only: card view uses the short one", byId.recSHORTONLY.description === "Only a short blurb exists here.");
check("short only: cart page falls back to the short one, rather than going blank",
  byId.recSHORTONLY.longDescription === "Only a short blurb exists here.", byId.recSHORTONLY.longDescription);

check("neither: card view is empty, not undefined", byId.recNEITHER.description === "");
check("neither: cart page is empty, not undefined", byId.recNEITHER.longDescription === "");
check("neither: raw shortDescription is empty", byId.recNEITHER.shortDescription === "");

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
