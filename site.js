/* Aledo Golf Carts — shared site behavior */

/* Every form (test drive request, part request, cart inquiry) submits here.
   This is the site's own endpoint — netlify/functions/lead.mjs — which
   records the lead in Airtable. Left blank, forms
   fall back to their normal Netlify submission so nothing breaks. */
var AGC_FORMS_ENDPOINT = '/api/lead';

/* Where a cart's own page lives.

   The readable part is for people and for search results; the record id
   on the end is what actually finds the cart. Keeping the id there means
   renaming a cart in the dashboard cannot break a link that is already
   out in the world — the old address still resolves, and the server
   redirects it to the new wording. Must stay in step with
   netlify/lib/cart-slug.mjs, which builds the same address server-side. */
function AGCCartUrl(cart) {
  if (!cart || !cart.id) return '';
  var words = [cart.year, cart.name, cart.color]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return '/carts/' + (words ? words + '-' : '') + cart.id;
}

/* One record from /api/inventory turned into the shape the listing grid
   and the single-cart page both draw from. Lives here because both read
   the same feed and must agree on what a cart is.

   The endpoint has already normalised names and statuses and dropped
   hidden carts; all that is left is the derived values the cards, the
   filters, and the price line need. */
function AGCCartFromApi(r) {
  if (!r || !r.name) return null;

  /* Every photo arrives in one shape:

       full   the big version, for the lightbox
       card   what a grid should load — smaller when that helps
       w, h   intrinsic size, so the page can reserve the space */
  var photos = (Array.isArray(r.gallery) ? r.gallery : [])
    .filter(function (p) { return p && p.full; })
    .map(function (p) {
      return { full: p.full, card: p.card || p.full, w: Number(p.width) || 0, h: Number(p.height) || 0 };
    });

  var c = {
    id: r.id || '',
    name: r.name,
    year: r.year || '',
    price: r.price || '',
    seats: r.seats || '',
    battery: r.battery || '',
    color: r.color || '',
    /* Two lengths of the same idea, and both have to survive this
       mapper. `description` is short-preferring — it is what the
       listing grid and the homepage cards draw. `longDescription` is
       long-preferring and only the cart's own page reads it.

       Leaving longDescription out here does not break loudly: the cart
       page falls back to `description` and quietly shows the short
       blurb on the one page that was supposed to show the full
       write-up. Both keys stay, together, for that reason. */
    description: r.description || '',
    longDescription: r.longDescription || '',
    photos: photos,
    status: r.status === 'pending' || r.status === 'sold' ? r.status : 'available',
    featured: r.featured === true
  };
  c.priceNum = parseFloat(String(c.price).replace(/[$,\s]/g, ''));
  c.seatsNum = parseInt(c.seats, 10) || null;
  c.type = /used|pre.?owned/i.test(r.type || '') ? 'Used' : (/new/i.test(r.type || '') ? 'New' : '');
  return c;
}

(function () {
  'use strict';

  /* Mobile nav toggle */
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.nav-links');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* Scroll-in animation */
  var faders = document.querySelectorAll('.fade-up');
  if (faders.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          setTimeout(function () { entry.target.classList.add('visible'); }, i * 80);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    faders.forEach(function (el) { observer.observe(el); });
    // Safety net: never leave content permanently invisible if the observer
    // doesn't fire (e.g. elements outside any scrollable viewport).
    setTimeout(function () {
      faders.forEach(function (el) { el.classList.add('visible'); });
      observer.disconnect();
    }, 2500);
  } else {
    faders.forEach(function (el) { el.classList.add('visible'); });
  }

  /* Footer year */
  var year = document.getElementById('footer-year');
  if (year) year.textContent = new Date().getFullYear();

  /* Form submissions → /api/lead (Airtable Leads; the email
     to sales@ is sent by an Airtable automation on the new record).
     If AGC_FORMS_ENDPOINT isn't configured yet, forms are left alone and
     submit normally through Netlify, so nothing breaks in the meantime. */
  if (AGC_FORMS_ENDPOINT) {
    document.querySelectorAll('.contact-form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var honeypot = form.querySelector('[name="bot-field"]');
        if (honeypot && honeypot.value) return; // bot — silently drop

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

        var payload = {};
        new FormData(form).forEach(function (value, key) { payload[key] = value; });
        payload.formType = form.getAttribute('name') || '';
        payload.pageUrl = window.location.href;

        fetch(AGC_FORMS_ENDPOINT, { method: 'POST', body: JSON.stringify(payload) })
          .catch(function () { /* server may still have processed it despite a CORS/read error */ })
          .then(function () { window.location.href = '/thank-you.html'; });
      });
    });
  }
})();
