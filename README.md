# Aledo Golf Carts — Website

This folder is the website, and only the website. **This is what Netlify deploys.**

The owner dashboard is deliberately *not* in here — see "The other folder" below.

## What's in here

```
*.html                    the 10 public pages
inventory.js              builds the cart cards from live inventory
site.js                   navigation, motion, form submission
styles.css                all site styling
assets/                   logo, hero video, page photos, fallback cart photos
netlify/functions/        the three server-side endpoints
netlify.toml              tells Netlify where things are
robots.txt                currently blocks search engines — see LAUNCH
sitemap.xml               public page list
_redirects                legacy URL redirects (Netlify)
redirects.htaccess        the same, for a non-Netlify host
```

## How inventory works

Cart data lives in **Airtable**, not in this repo. The site never talks to Airtable
directly, because Airtable needs a token for every request and a static site can't
keep a secret. Instead:

```
Airtable ──token, server-side──► /api/inventory ──► the website
```

`netlify/functions/inventory.mjs` holds the token and hands back just the cart data.
The response is cached briefly, which also keeps us inside Airtable's monthly API
allowance.

Two more endpoints work the same way:

| Endpoint | Function | Purpose |
|---|---|---|
| `/api/inventory` | `inventory.mjs` | Public read of the lot. Cached. Shows the owner more — see below. |
| `/api/lead` | `lead.mjs` | Receives website forms, writes to Airtable Leads. |
| `/api/cart` | `cart.mjs` | Lets the owner dashboard edit inventory. Locked. |
| `/api/leads` | `leads.mjs` | Shows enquiries in the dashboard. Locked — holds customer PII. |

### Why `/api/inventory` answers two different ways

It is a public endpoint, but the owner dashboard sees two extra things:
the date each cart was added (which the dashboard shows as "days on the
lot") and the carts marked **Hide**.

Both are withheld from the public on purpose. How long a cart has been
sitting is a negotiating position, and a hidden cart is hidden precisely
so nobody outside sees it.

The extra data appears only when **both** are true:

1. the request carries a valid `X-Owner-Key` header, and
2. the URL has `?fresh=1`.

The second condition is not redundant. `?fresh=1` is the path that
answers `Cache-Control: no-store`. Without it the response is cacheable,
and a CDN could hand the owner's copy to the next anonymous visitor —
hidden carts and all. Tying the extra data to the uncached path rules
that out by construction rather than depending on `Vary` being right.

A wrong key is not an error here. Anyone browsing the website is not
doing anything wrong, so they simply get the ordinary public response.

## Required environment variables

Set these in Netlify → Site configuration → Environment variables. Without them the
site still loads, but inventory falls back to built-in sample carts.

| Variable | What it is |
|---|---|
| `AIRTABLE_TOKEN` | Airtable personal access token, `data.records:read` **and** `:write`, scoped to the Aledo base only. |
| `OWNER_KEY` | A passphrase you invent. Gates `/api/cart`. **Editing is disabled until this is set** — it fails closed on purpose. |
| `INVENTORY_CACHE_SECONDS` | Optional. Defaults to 60. Raise it if you approach Airtable's API quota. |

Environment variables only take effect on a **new deploy**, so trigger one after
changing them.

## Deploying

Netlify builds from this folder. There is no build step — the HTML, CSS, and JS are
served as-is, and the functions in `netlify/functions/` are deployed automatically.

## ⚠️ Before going live

This site is currently on a `netlify.app` address and **`robots.txt` blocks all search
engines on purpose**. The domain `aledogolfcarts.com` belongs to a different business;
this project is a replacement being built alongside it.

Every canonical URL, social preview image, and structured-data entry currently points
at the staging address. All of that has to change when a real domain is attached.

The full list of launch steps lives in **`LAUNCH-CHECKLIST.md`** in the owner dashboard
folder.

## The other folder

The owner dashboard lives beside this one, in **`Aledo Golf Carts - Owner Dashboard/`**.

It is a standalone folder that is *not* deployed. That's deliberate: it's an internal
tool, and putting it inside the deploy would make it publicly reachable on the live
site. It reaches this site's `/api/*` endpoints over the internet, so it works from
anywhere — including opened straight from disk.

Hand that folder to the client. Hand this one to Netlify.
