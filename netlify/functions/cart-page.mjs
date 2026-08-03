/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — a page for every cart

   Serves /carts/<slug>-<record id>. Every cart in Airtable has one
   of these the moment it is added in the owner dashboard; there is
   no file to write and nothing to publish.

   ── Why this is rendered here rather than in the browser ──
   The page could just as easily be filled in by JavaScript, and for
   a visitor with a browser it would look identical. But two of the
   most valuable things a cart listing does are read by software that
   does not run JavaScript at all:

     • Facebook, Messenger, iMessage, and WhatsApp build a link
       preview purely from the og: tags in the HTML they receive. The
       owner posts carts to Marketplace; a link that previews as the
       bare site logo instead of the cart is a wasted post.
     • Google will render JavaScript, eventually and unreliably. A
       title and price already in the HTML is indexed on the first
       pass, which for inventory that turns over in weeks is the
       difference between being findable and not.

   ── How ──
   The chrome — nav, footer, fonts, the inquiry form — is not
   duplicated here. It lives in cart.html like every other page on
   this site, which is fetched (from the CDN, so effectively free)
   and has this cart's head tags and data dropped into it. That way
   editing the site's navigation does not mean editing a template
   buried in a function.

   The response is cached exactly like the inventory feed, so a price
   change in the dashboard reaches these pages within the minute.
   ═══════════════════════════════════════════════════════════ */

import { cartPath, idFromSlug } from "../lib/cart-slug.mjs";

export const config = { path: "/carts/:slug" };

/* The address these pages are known by. Deploy previews render the
   same pages, but their canonical and og:url must still point at the
   real site — otherwise a preview URL is what gets shared or indexed. */
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://aledogolfcarts.com").replace(/\/+$/, "");

/* Matches the inventory feed, so a page and the listing it came from
   never disagree about the price for more than a moment. */
const CACHE_SECONDS = Number(process.env.INVENTORY_CACHE_SECONDS) || 60;

const FALLBACK_IMAGE = `${SITE_ORIGIN}/assets/og-card.jpg`;

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* Safe to sit inside a <script> block: the only sequence that could end
   it early is a literal "<", and < is the same character to JSON. */
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function titleOf(cart) {
  return `${cart.year ? `${cart.year} ` : ""}${cart.name}`;
}

/* What a person sees under the link in Google, and under the photo on
   Facebook. The owner's own description when there is one, because it
   is always better than anything assembled from fields. */
function descriptionOf(cart) {
  if (cart.description) return cart.description.replace(/\s+/g, " ").trim().slice(0, 300);

  const parts = [];
  if (cart.type) parts.push(cart.type.toLowerCase());
  if (cart.seats) parts.push(`${cart.seats}-passenger`);
  if (cart.battery) parts.push(cart.battery.toLowerCase());
  if (cart.color) parts.push(cart.color.toLowerCase());

  const spec = parts.length ? ` — ${parts.join(", ")}` : "";
  const price = Number(String(cart.price).replace(/[^0-9.]/g, ""));
  const money = price > 0 ? ` Priced at $${Math.round(price).toLocaleString("en-US")}.` : "";

  return `${titleOf(cart)}${spec}, in stock at Aledo Golf Carts in Aledo, TX.${money} Come drive it.`;
}

function availabilityOf(status) {
  if (status === "sold") return "https://schema.org/SoldOut";
  if (status === "pending") return "https://schema.org/LimitedAvailability";
  return "https://schema.org/InStock";
}

function productSchema(cart, url) {
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: titleOf(cart),
    category: "Golf Cart",
    description: descriptionOf(cart),
    url
  };

  if (cart.color) product.color = cart.color;
  if (cart.photos && cart.photos.length) product.image = cart.photos;

  const price = Number(String(cart.price).replace(/[^0-9.]/g, ""));
  if (price > 0) {
    product.offers = {
      "@type": "Offer",
      price: String(Math.round(price)),
      priceCurrency: "USD",
      url,
      availability: availabilityOf(cart.status),
      itemCondition: /used|pre.?owned/i.test(cart.type || "")
        ? "https://schema.org/UsedCondition"
        : "https://schema.org/NewCondition",
      seller: { "@id": "https://aledogolfcarts.com/#dealer" }
    };
  }

  return product;
}

function breadcrumbSchema(cart, url) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Inventory", item: `${SITE_ORIGIN}/inventory.html` },
      { "@type": "ListItem", position: 3, name: titleOf(cart), item: url }
    ]
  };
}

function pageTitle(cart) {
  return `${titleOf(cart)} for Sale in Aledo, TX | Aledo Golf Carts`;
}

function headFor(cart, url) {
  const description = descriptionOf(cart);

  /* The first photo is the link preview. A cart with none falls back to
     the site card rather than to nothing, because a link with no image
     at all collapses to a bare grey row on Facebook. */
  const cover = (cart.gallery && cart.gallery[0]) || null;
  const image = cover ? cover.full : FALLBACK_IMAGE;
  const dimensions = cover && cover.width && cover.height
    ? `<meta property="og:image:width" content="${cover.width}" />\n` +
      `<meta property="og:image:height" content="${cover.height}" />`
    : '<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />';

  return [
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta name="theme-color" content="#1A1B1C" />`,
    ``,
    `<meta property="og:type" content="product" />`,
    `<meta property="og:title" content="${esc(titleOf(cart))}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:site_name" content="Aledo Golf Carts" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    dimensions,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(titleOf(cart))}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ``,
    `<script type="application/ld+json">${jsonForScript(productSchema(cart, url))}</script>`,
    `<script type="application/ld+json">${jsonForScript(breadcrumbSchema(cart, url))}</script>`,
    ``,
    `<script>window.AGC_CART = ${jsonForScript(cart)};</script>`
  ].join("\n");
}

function page(html, status, cacheable) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheable
        ? `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`
        : "no-store"
    }
  });
}

/* The site's own 404, so a mistyped cart address lands somewhere that
   looks like the rest of the site rather than on Netlify's default. */
async function notFound(origin) {
  const response = await fetch(`${origin}/404.html`);
  const html = response.ok
    ? await response.text()
    : "<!doctype html><title>Not found</title><p>That cart isn't on the lot.</p>";
  return page(html, 404, false);
}

export default async function handler(request) {
  const requested = new URL(request.url);
  const origin = requested.origin;

  const id = idFromSlug(requested.pathname.split("/").filter(Boolean).pop());
  if (!id) return notFound(origin);

  let carts;
  try {
    /* The public feed, through the CDN — so the usual case costs no
       Airtable call at all, and hidden carts are already filtered out
       before this function can see them. */
    const response = await fetch(`${origin}/api/inventory`);
    if (!response.ok) throw new Error(`inventory responded ${response.status}`);
    carts = (await response.json()).carts || [];
  } catch {
    /* Cannot say whether this cart exists, so do not answer as if it
       does not — a 404 here would invite Google to drop a page that is
       perfectly fine. Send them to the listing, uncached, and let the
       next request try again. */
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/inventory.html`, "Cache-Control": "no-store" }
    });
  }

  const cart = carts.find((c) => c.id === id);
  if (!cart) return notFound(origin);

  /* One address per cart. A renamed cart keeps working on its old
     wording and is sent here, so the link that is already on Facebook
     stays good and Google is told where the page moved to. */
  const canonicalPath = cartPath(cart);
  if (requested.pathname !== canonicalPath) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: canonicalPath + requested.search,
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`
      }
    });
  }

  const shell = await fetch(`${origin}/cart.html`);
  if (!shell.ok) {
    /* The shell is a static file on the same site, so this should not
       happen — but a cart page that cannot be built is still no reason
       to tell the world the cart does not exist. */
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/inventory.html`, "Cache-Control": "no-store" }
    });
  }

  const html = (await shell.text())
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(pageTitle(cart))}</title>`)
    .replace("<!--AGC:HEAD-->", headFor(cart, SITE_ORIGIN + canonicalPath));

  return page(html, 200, true);
}
