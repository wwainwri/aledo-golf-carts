/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — sitemap of the cart pages

   sitemap.xml lists the pages that exist as files. The cart pages
   do not: they come and go as the owner adds and sells carts, so
   this builds their list from the live inventory instead.

   Without this the cart pages are still crawlable — they are linked
   from the inventory grid — but Google would find each one on its
   own schedule. Inventory that turns over in weeks cannot wait for
   that, and a sitemap is the only way to say "this one is new, come
   and look" the day it lands.

   Sold carts are left out on purpose. Their pages still work, and
   still rank for anyone who has the link, but there is nothing to
   gain by asking Google to go and index something that cannot be
   bought.

   Listed in robots.txt alongside the main sitemap.
   ═══════════════════════════════════════════════════════════ */

import { cartPath } from "../lib/cart-slug.mjs";

export const config = { path: "/sitemap-carts.xml" };

const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://aledogolfcarts.com").replace(/\/+$/, "");

/* Longer than the pages themselves: a crawler re-reads this on its own
   schedule, measured in hours, so refreshing it every minute would buy
   nothing. */
const CACHE_SECONDS = 900;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  }[c]));
}

export default async function handler(request) {
  const origin = new URL(request.url).origin;

  let carts = [];
  try {
    const response = await fetch(`${origin}/api/inventory`);
    if (response.ok) carts = (await response.json()).carts || [];
  } catch {
    /* An empty sitemap is harmless — a crawler simply finds nothing new
       this time. Failing the request would be read as a broken sitemap,
       which is worse. */
  }

  const today = new Date().toISOString().slice(0, 10);

  const urls = carts
    .filter((cart) => cart.status !== "sold" && cart.status !== "hidden")
    .map((cart) => [
      "  <url>",
      `    <loc>${escapeXml(SITE_ORIGIN + cartPath(cart))}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      "    <changefreq>weekly</changefreq>",
      "    <priority>0.8</priority>",
      "  </url>"
    ].join("\n"))
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`
    }
  });
}
