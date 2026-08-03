# Aledo Golf Carts — Website

This folder is the website, and only the website. **This is what Netlify deploys.**

The owner dashboard is deliberately *not* in here — see "The other folder" below.

## What's in here

```
*.html                    the public pages
service.html              service department + the online service request
financing.html            lenders, apply-online links, payment & trade-in tools
cart.html                 the shell every cart's own page is rendered into
inventory.js              builds the cart cards from live inventory
cart-page.js              builds one cart's page
photo-viewer.js           photo carousel + full-size viewer, shared by both
site.js                   navigation, motion, form submission, cart addresses
styles.css                all site styling
assets/                   logo, hero video, page photos, fallback cart photos
netlify/functions/        the server-side endpoints
netlify.toml              tells Netlify where things are
robots.txt                crawl rules and where the sitemaps are
sitemap.xml               public page list (the cart pages have their own)
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

## Lender links

Both lenders on `financing.html` open their own application form directly,
carrying our dealer number so it arrives attributed to us:

| Lender | Dealer number | Where it goes |
|---|---|---|
| Sheffield Financial | `56815` | `prequalify.sheffieldfinancial.com` — soft credit check |
| Dealer Direct | `10841` | `dealerdirect.apptraker.com/my/guest` |

Neither number is a secret — both travel in the public URL. If the Dealer Direct
number is ever blanked or mistyped, that button falls back to the contact page
rather than sending customers to a broken application. It lives in one place,
`DEALER_DIRECT_ID` near the bottom of `financing.html`.

## Service and financing are separate pages

They used to share one page with three tabbed calculators. They are now
`service.html` and `financing.html`, because the two are different jobs done by
different people: one is "my cart is broken", the other is "I want to buy a cart".
Splitting them means each can rank for its own searches and lead with its own
call to action instead of burying both behind a tab.

- **`service.html`** — what the shop fixes, the cost estimator, and an online
  **service request form**. The form asks who you are, which cart it is (make,
  model, year, serial), and a free-text description of the problem, which is the
  part that actually saves a phone call. Tick boxes in the estimator and the list
  is carried into the description for you.
- **`financing.html`** — both lenders with apply-online buttons, how the process
  works, and the payment and trade-in calculators.

Both forms post to `/api/lead` like every other form on the site. A service request
arrives in Airtable tagged `[Service Request]` with the cart identified on one line
("2019 Club Car Onward"), the customer's description, their preferred date, and
their ZIP.

The old `/service-financing.html` address 301s to the service page, so the ranking
it earned is not thrown away.

## Every cart has its own page

There is no per-cart file to create. A cart added in the owner dashboard has a
page within the minute, at

```
/carts/2026-madjax-ascent-matte-black-recXXXXXXXXXXXXXX
```

built by `netlify/functions/cart-page.mjs` from the same `/api/inventory` feed the
inventory grid reads. Change the price in the dashboard and the page shows the new
one. Mark a cart **Sold** and its page says so. Mark it **Hide** and the page stops
resolving, because hidden carts never leave the server.

The readable part of the address is for people and search results; the record id on
the end is what finds the cart. That is why **renaming a cart cannot break a link
already out in the world** — the old address still works and redirects to the new
wording, which matters when the link is in someone's text messages or on a
Marketplace post.

### Why these pages are built on the server

The page could just as easily be filled in by JavaScript in the browser, and to a
visitor it would look identical. Two things that make a cart listing valuable are
read by software that does not run JavaScript at all:

- **Link previews.** Facebook, Messenger, iMessage and WhatsApp build the preview
  purely from the tags in the HTML they are handed. A cart posted to Marketplace has
  to arrive already carrying its own photo and price, not the site logo.
- **Search.** Google will run JavaScript eventually and unreliably. A title and
  price already in the HTML is indexed on the first visit, which for stock that
  turns over in weeks is the difference between being found and not.

The site's nav, footer and forms are **not** duplicated inside the function — it
fetches `cart.html` and drops that cart's tags and data into it. Editing the
navigation is still a matter of editing one HTML file.

`sitemap-carts.mjs` lists the cart pages for Google in the same live way, and is
named in `robots.txt`. Sold carts are left out of it; their pages still work.

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
| `INVENTORY_CACHE_SECONDS` | Optional. Defaults to 60. Raise it if you approach Airtable's API quota. It is also how long a dashboard edit takes to reach a cart's page. |
| `SITE_ORIGIN` | Optional. Defaults to `https://aledogolfcarts.com`. The address the cart pages call themselves — it fills every canonical tag, link-preview URL, and photo address. **Set this the day a real domain is attached**, or shared links and search results will keep pointing at the old one. |

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
