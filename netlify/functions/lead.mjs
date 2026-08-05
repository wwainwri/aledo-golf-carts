/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — website form receiver

   Every form on the site (cart inquiry, part request, test drive)
   posts here, and each submission becomes a record in the Airtable
   Leads table.

   The email to sales@aledogolfcarts.com is sent by an Airtable
   automation triggered on that new record — see
   airtable-automations/README.md. Doing it there rather than here
   means no email vendor to own, and it still fires if a lead is
   ever added by hand.

   Environment variables (Netlify → Site configuration):
     AIRTABLE_TOKEN   read + write on the Aledo base
   ═══════════════════════════════════════════════════════════ */

export const config = { path: "/api/lead" };

const AIRTABLE_API = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appcZt06B1gHgQwXr";
const LEADS_TABLE = process.env.AIRTABLE_LEADS_TABLE || "tbl6eydRTXlkvykP6";

const FORM_LABELS = {
  "test-drive-request": "Test Drive / General Inquiry",
  "part-request": "Part or Quote Request",
  "cart-inquiry": "Cart Inquiry",
  "service-request": "Service Request"
};

function formLabel(formType) {
  return FORM_LABELS[formType] || formType || "Website Form";
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 2000);
}

/* The service request asks which cart it is, across four fields. They
   are worth more to whoever picks the job up as one line — "2019 Club
   Car Onward" — than as four separate ones. */
function describeCart(data) {
  const label = [clean(data.year, 10), clean(data.make, 60), clean(data.model, 80)]
    .filter(Boolean)
    .join(" ");
  const serial = clean(data.serial, 60);
  return serial ? `${label} (serial ${serial})`.trim() : label;
}

/** Maps the raw posted fields (which vary per form) into one shape. */
function normalizeLead(data) {
  return {
    formType: clean(data.formType || data["form-name"], 100),
    name: clean(data.name, 200),
    email: clean(data.email, 200),
    phone: clean(data.phone, 60),
    interest: clean(data.interest || data.category, 200),
    /* Whichever cart this lead is about: the one they want to buy, or
       on a service request the one they want us to look at. */
    cart: clean(data.cart, 200) || describeCart(data),
    details: clean(data.details || data.description, 4000),
    zip: clean(data.zip, 20),
    preferredDate: clean(data.preferred_date, 40),
    tcpaConsent: clean(data.tcpa_consent, 20),
    pageUrl: clean(data.pageUrl, 500),
    submittedAt: new Date()
  };
}

/** Folds the per-form extras into one readable block. */
function inquiryDetails(lead) {
  const parts = ["[" + formLabel(lead.formType) + "]"];
  if (lead.details) parts.push(lead.details);
  if (lead.interest) parts.push("Interest: " + lead.interest);
  if (lead.cart) parts.push("Cart: " + lead.cart);
  if (lead.preferredDate) parts.push("Preferred date: " + lead.preferredDate);
  if (lead.zip) parts.push("ZIP: " + lead.zip);
  return parts.join("\n\n");
}

/* ─────────────────────── AIRTABLE ─────────────────────── */

async function createAirtableLead(lead) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN is not set on this site.");

  const fields = {
    "Full Name": lead.name,
    "Email Address": lead.email,
    "Phone Number": lead.phone,
    "Inquiry Details": inquiryDetails(lead),
    /* A single select the dashboard can filter and badge on — the
       [Label] prefix in Inquiry Details is for a human skimming
       Airtable directly, this is for code. typecast:true lets a new
       label here create its own option rather than erroring, but the
       four values must still match FORM_LABELS or a lead lands
       "New form type" with no styling. */
    "Request Type": formLabel(lead.formType),
    "Submission Date": lead.submittedAt.toISOString().slice(0, 10),
    /* Lead Source is a channel (Website Form / Phone Call / Walk-In),
       not a form name. Which form it was goes in Inquiry Details. */
    "Lead Source": "Website Form",
    "Status": "New",
    "Cart Interest": lead.cart,
    "TCPA Consent": lead.tcpaConsent ? "Yes" : "No",
    "Page": lead.pageUrl
  };

  for (const key of Object.keys(fields)) {
    if (fields[key] === "" || fields[key] == null) delete fields[key];
  }

  const response = await fetch(`${AIRTABLE_API}/${BASE_ID}/${LEADS_TABLE}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      records: [{ fields }],
      /* Lets Airtable accept a select value it hasn't seen rather
         than rejecting the whole lead. */
      typecast: true
    })
  });

  if (!response.ok) throw new Error(`Airtable responded ${response.status}`);
  return "created";
}

/* ───────────────────────── HANDLER ───────────────────────── */

/** Runs fn(), turning a thrown error into a readable status string. */
async function safely(fn) {
  try {
    return await fn();
  } catch (error) {
    return "error: " + (error.message || "unknown");
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store"
    }
  });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return json({ ok: true }, 200);
  if (request.method !== "POST") {
    return json({ ok: false, error: "This endpoint accepts POST requests only." }, 405);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the submission." }, 400);
  }

  /* Netlify's honeypot field. A bot fills it in; a person never sees it.
     Answer 200 so the bot believes it succeeded and moves on. */
  if (clean(data["bot-field"])) return json({ ok: true, steps: {} }, 200);

  const lead = normalizeLead(data);

  /* A lead with no way to reach them back is worthless and is almost
     always a bot or a misfire. */
  if (!lead.email && !lead.phone) {
    return json({ ok: false, error: "An email address or phone number is required." }, 400);
  }

  const steps = {};
  steps.airtable = await safely(() => createAirtableLead(lead));

  const stored = !String(steps.airtable).startsWith("error");
  return json({ ok: stored, steps }, stored ? 200 : 502);
}
