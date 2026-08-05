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

globalThis.fetch = async (url) => {
  if (String(url).includes("/tbl6eydRTXlkvykP6")) {
    return new Response(JSON.stringify({ records }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: "unstubbed" }), { status: 500 });
};

const { default: leads } = await import(`file:///${ROOT}/netlify/functions/leads.mjs`);

const res = await leads(new Request("https://aledogolfcarts.com/api/leads", {
  headers: { "X-Owner-Key": process.env.OWNER_KEY }
}));
const body = await res.json();

check("200", res.status === 200, res.status);
check("all three leads returned", body.leads.length === 3, body.leads.length);

const byId = Object.fromEntries(body.leads.map((l) => [l.id, l]));

check("new-style lead reads Request Type directly", byId.recNEW1.type === "Service Request", byId.recNEW1.type);
check("old-style lead's type is sniffed from the [Label] prefix", byId.recOLD1.type === "Cart Inquiry", byId.recOLD1.type);
check("a lead with neither gets an empty type, not a crash", byId.recANCIENT.type === "", byId.recANCIENT.type);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
