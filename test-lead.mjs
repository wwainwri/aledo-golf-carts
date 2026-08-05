/* Checks what a lead submission actually writes to Airtable. */

const ROOT = "C:/Users/willi/OneDrive/Documents/Claude Code/AGC/Aledo Golf Carts";
process.env.AIRTABLE_TOKEN = "test-token";

let captured = null;
globalThis.fetch = async (url, init) => {
  captured = JSON.parse(init.body);
  return new Response(JSON.stringify({ records: [{ id: "recTEST" }] }), { status: 200 });
};

const { default: lead } = await import(`file:///${ROOT}/netlify/functions/lead.mjs`);

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

async function post(body) {
  captured = null;
  const res = await lead(new Request("https://aledogolfcarts.com/api/lead", {
    method: "POST",
    body: JSON.stringify(body)
  }));
  return { res, fields: captured && captured.records[0].fields };
}

/* ── a full service request, as service.html sends it ── */
console.log("\nservice request from service.html");
const { res, fields } = await post({
  "form-name": "service-request",
  formType: "service-request",
  name: "Dana Whitfield",
  email: "dana@example.com",
  phone: "817-555-0114",
  zip: "76008",
  make: "Club Car",
  model: "Onward",
  year: "2019",
  serial: "PQ1932-889210",
  description: "Won't hold a charge past about two miles. New charger last spring, batteries are original.",
  preferred_date: "2026-08-11",
  tcpa_consent: "Yes",
  pageUrl: "https://aledogolfcarts.com/service.html"
});

check("200", res.status === 200, `got ${res.status}`);
check("name", fields["Full Name"] === "Dana Whitfield");
check("email", fields["Email Address"] === "dana@example.com");
check("phone", fields["Phone Number"] === "817-555-0114");
check("TCPA recorded", fields["TCPA Consent"] === "Yes");
check("page recorded", fields["Page"] === "https://aledogolfcarts.com/service.html");
check("Request Type is its own field", fields["Request Type"] === "Service Request", fields["Request Type"]);
check("labelled a Service Request in Inquiry Details too", fields["Inquiry Details"].startsWith("[Service Request]"));
check("the customer's description survives", fields["Inquiry Details"].includes("Won't hold a charge past about two miles"));
check("cart identified in one line", fields["Cart Interest"] === "2019 Club Car Onward (serial PQ1932-889210)", fields["Cart Interest"]);
check("preferred date carried", fields["Inquiry Details"].includes("Preferred date: 2026-08-11"));
check("zip carried", fields["Inquiry Details"].includes("ZIP: 76008"));

console.log("\n  --- what the owner sees in Airtable ---");
console.log(fields["Inquiry Details"].split("\n").map((l) => "  | " + l).join("\n"));

/* ── the sparse case: no cart details at all ── */
console.log("\nservice request with only the required fields");
const sparse = await post({
  formType: "service-request",
  name: "Sam Ortiz",
  email: "sam@example.com",
  phone: "817-555-0199",
  zip: "76086",
  make: "Other / not sure",
  description: "Makes a grinding noise turning left.",
  tcpa_consent: "Yes"
});
check("200", sparse.res.status === 200);
check("cart is just the make", sparse.fields["Cart Interest"] === "Other / not sure", sparse.fields["Cart Interest"]);
check("no empty preferred-date line", !sparse.fields["Inquiry Details"].includes("Preferred date:"));
check("Request Type still set on the sparse case", sparse.fields["Request Type"] === "Service Request");

/* ── the other forms must be unaffected, and each gets its own Request Type ── */
console.log("\nexisting forms still behave");
const cart = await post({
  formType: "cart-inquiry",
  name: "Jo Rivera",
  email: "jo@example.com",
  phone: "817-555-0100",
  cart: "2026 Madjax Ascent",
  tcpa_consent: "Yes"
});
check("cart inquiry labelled", cart.fields["Inquiry Details"].startsWith("[Cart Inquiry]"));
check("cart inquiry Request Type", cart.fields["Request Type"] === "Cart Inquiry", cart.fields["Request Type"]);
check("cart interest preserved", cart.fields["Cart Interest"] === "2026 Madjax Ascent");
check("no stray cart line from empty make/model", !cart.fields["Inquiry Details"].includes("Cart: 2026 Madjax Ascent (serial"));

const part = await post({
  formType: "part-request",
  name: "Lee Nguyen",
  email: "lee@example.com",
  phone: "817-555-0122",
  category: "Lift kits",
  details: "Need a 6-inch lift for a 2021 EZ-GO.",
  tcpa_consent: "Yes"
});
check("part request labelled", part.fields["Inquiry Details"].startsWith("[Part or Quote Request]"));
check("part request Request Type", part.fields["Request Type"] === "Part or Quote Request", part.fields["Request Type"]);
check("interest preserved", part.fields["Inquiry Details"].includes("Interest: Lift kits"));
check("no Cart Interest invented", part.fields["Cart Interest"] === undefined, String(part.fields["Cart Interest"]));

const testDrive = await post({
  formType: "test-drive-request",
  name: "Pat Kim",
  email: "pat@example.com",
  phone: "817-555-0133",
  tcpa_consent: "Yes"
});
check("test drive Request Type", testDrive.fields["Request Type"] === "Test Drive / General Inquiry", testDrive.fields["Request Type"]);

/* An unrecognized formType must not crash the write — it should still
   tag something sensible rather than silently losing the field. */
const unknown = await post({
  formType: "some-future-form",
  name: "Alex Doe",
  email: "alex@example.com",
  tcpa_consent: "Yes"
});
check("unknown form type still gets a Request Type", unknown.fields["Request Type"] === "some-future-form", unknown.fields["Request Type"]);

/* ── junk still refused ── */
console.log("\nguards");
const noContact = await post({ formType: "service-request", name: "Nobody", description: "hi" });
check("no email or phone → 400", noContact.res.status === 400, `got ${noContact.res.status}`);
const bot = await post({ formType: "service-request", "bot-field": "spam", name: "Bot", email: "b@x.com" });
check("honeypot silently dropped", bot.res.status === 200 && bot.fields === null);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
