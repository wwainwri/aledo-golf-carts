/* ═══════════════════════════════════════════════════════════
   Where a cart's page lives, and how to find it again.

       /carts/2026-madjax-ascent-matte-black-recXXXXXXXXXXXXXX

   The readable part is for people and for search results. The record
   id on the end is what actually identifies the cart, and it is there
   so that renaming a cart in the dashboard cannot break a link that is
   already out in the world — on Facebook, in a text message, in
   Google's index. The old address still finds the cart, and
   cart-page.mjs redirects it to the current wording.

   site.js builds the same address in the browser. Change one, change
   both.
   ═══════════════════════════════════════════════════════════ */

/** Airtable record ids are opaque but well formed. */
export const REC = /^rec[A-Za-z0-9]{10,20}$/;

export function cartSlug(cart) {
  const words = [cart.year, cart.name, cart.color]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${words ? `${words}-` : ""}${cart.id}`;
}

export function cartPath(cart) {
  return `/carts/${cartSlug(cart)}`;
}

/** The record id out of whatever address the visitor arrived on. */
export function idFromSlug(slug) {
  const match = String(slug || "").match(/(rec[A-Za-z0-9]{10,20})$/);
  return match ? match[1] : "";
}
