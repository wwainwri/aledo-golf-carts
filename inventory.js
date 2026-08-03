/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — Airtable inventory loader

   Inventory lives in the "Inventory Items" table of the Aledo Golf
   Carts Airtable base. Add a record → the cart appears here. Set
   Status to Sold → the site shows it sold. No code, no uploads.

   This file does NOT talk to Airtable directly, on purpose:
   Airtable requires a token for every read, and a token in
   front-end JavaScript would be readable by anyone — including a
   token that opens the Leads table full of customer phone numbers.
   Instead it reads /api/inventory, a small server-side function
   (netlify/functions/inventory.mjs) that holds the token safely and
   is cached by the CDN so we stay under Airtable's rate limit.

   Fields the endpoint returns for each cart:

     id           "recXXXXXXXXXXXXXX" — the cart's own page lives at
                  /carts/<slug>-<id>, rendered from this same feed
     name         "Madjax Ascent"   (required — records with no name are skipped)
     year         "2026"
     price        "12995", or text like "Call for pricing"
     seats        "2", "4", "6"
     type         "New" or "Used"
     battery      "Lithium", "Lead-Acid", "Gas"
     color        "Matte Black"
     description  one or two sentences shown on the card
     photos       array of image links (the cover photo is the first)
     gallery      the same photos with a thumbnail and pixel size each
     status       "available", "pending", or "sold"
     featured     true to show the cart on the homepage

   Carts with Status = Hide are filtered out server-side and never
   reach the browser at all.

   See AIRTABLE-SETUP.md in this folder for the field-by-field guide.
   ═══════════════════════════════════════════════════════════ */

var AGC_INVENTORY_API = '/api/inventory';

(function () {
  'use strict';

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* A record becomes a cart in site.js, so this page and each cart's own
     page agree on what the feed means. */
  function apiToCarts(records) {
    return (records || []).map(window.AGCCartFromApi).filter(Boolean);
  }

  function priceHtml(c) {
    if (!isNaN(c.priceNum) && c.priceNum > 0) return '$' + Math.round(c.priceNum).toLocaleString();
    return '<span>' + (esc(c.price) || 'Call for pricing') + '</span>';
  }

  function cardHtml(c, idx) {
    var title = esc((c.year ? c.year + ' ' : '') + c.name);
    var badges = '';
    if (c.status === 'sold') badges += '<span class="badge badge-sold">Sold</span>';
    else if (c.status === 'pending') badges += '<span class="badge badge-pending">Sale Pending</span>';
    else if (c.type) badges += '<span class="badge' + (c.type === 'Used' ? ' badge-used' : '') + '">' + c.type + '</span>';

    var photo;
    if (c.photos.length) {
      var first = c.photos[0];
      var total = c.photos.length;

      /* Width and height are set when we know them so the grid reserves
         the right space and nothing jumps as photos arrive. */
      var size = first.w && first.h ? ' width="' + first.w + '" height="' + first.h + '"' : '';

      photo = '<img class="cart-img" src="' + esc(first.card) + '"' + size +
        ' alt="' + title + ' golf cart at Aledo Golf Carts"' +
        (idx < 4 ? '' : ' loading="lazy"') + ' decoding="async"' +
        ' onerror="this.closest(\'.cart-photo\').innerHTML=\'<img class=cart-placeholder src=assets/logo.png alt=\\\'\\\'>\';" />';

      /* The whole photo is the button that opens the full-size view.
         A separate icon would be one more thing to aim at on a phone. */
      photo += '<button class="photo-zoom" aria-label="View ' + title + ' photos full size"></button>';

      if (total > 1) {
        photo += '<button class="photo-nav prev" aria-label="Previous photo" tabindex="-1">&#8249;</button>' +
                 '<button class="photo-nav next" aria-label="Next photo" tabindex="-1">&#8250;</button>' +
                 '<span class="photo-count"><span class="photo-at">1</span> / ' + total + '</span>';

        /* Dots stay useful up to about eight; beyond that the counter
           is doing the work and a row of specks is just noise. */
        if (total <= 8) {
          var dots = '';
          for (var d = 0; d < total; d++) {
            dots += '<span class="photo-dot' + (d === 0 ? ' on' : '') + '"></span>';
          }
          photo += '<span class="photo-dots" aria-hidden="true">' + dots + '</span>';
        }
      }
    } else {
      photo = '<img class="cart-placeholder" src="assets/logo.png" alt="" />';
    }

    var chips = [];
    if (c.seatsNum) chips.push(c.seatsNum + '-Passenger');
    if (c.battery) chips.push(esc(c.battery));
    if (c.color) chips.push(esc(c.color));
    var chipHtml = chips.length
      ? '<div class="cart-specs">' + chips.map(function (s) { return '<span class="spec-chip">' + s + '</span>'; }).join('') + '</div>'
      : '';

    /* Every cart has its own page, so the card's job is to get the
       visitor there rather than to hold the whole listing itself. */
    var href = window.AGCCartUrl ? window.AGCCartUrl(c) : '';
    var heading = href ? '<a href="' + esc(href) + '">' + title + '</a>' : title;
    var ask = href
      ? '<div class="cart-ask"><a class="btn-primary" href="' + esc(href) + '">' +
        (c.status === 'sold' ? 'See This Cart' : 'View Details') + '</a></div>'
      : '';

    return '<div class="cart-card fade-up visible' + (c.status === 'sold' ? ' sold' : '') + '" data-idx="' + idx + '">' +
      '<div class="cart-photo">' + photo + '<div class="cart-badges">' + badges + '</div></div>' +
      '<div class="cart-body">' +
        '<h3>' + heading + '</h3>' +
        '<div class="cart-price">' + priceHtml(c) + '</div>' +
        chipHtml +
        (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        ask +
      '</div>' +
    '</div>';
  }

  /* Preloading, swipe, and the full-size viewer are shared with each
     cart's own page — see photo-viewer.js. */
  var preload = window.AGCPhotos.preload;
  var wireSwipe = window.AGCPhotos.wireSwipe;

  function openLightbox(cart, at) {
    window.AGCPhotos.open({
      title: (cart.year ? cart.year + ' ' : '') + cart.name,
      photos: cart.photos
    }, at);
  }

  function wirePhotoNav(grid, carts) {
    grid.querySelectorAll('.cart-card').forEach(function (card) {
      var c = carts[+card.dataset.idx];
      if (!c || !c.photos.length) return;

      var stage = card.querySelector('.cart-photo');
      var img = card.querySelector('.cart-img');
      var zoom = card.querySelector('.photo-zoom');
      var pos = 0;

      if (zoom) {
        zoom.addEventListener('click', function (e) {
          e.preventDefault();
          openLightbox(c, pos);
        });
      }

      if (c.photos.length < 2) return;

      var at = card.querySelector('.photo-at');
      var dots = card.querySelectorAll('.photo-dot');

      function show(delta) {
        pos = (pos + delta + c.photos.length) % c.photos.length;
        img.src = c.photos[pos].card;
        if (at) at.textContent = String(pos + 1);
        dots.forEach(function (dot, i) { dot.classList.toggle('on', i === pos); });
        /* Whichever way they are going, the one after next is likely. */
        preload(c.photos[(pos + 1) % c.photos.length].card);
        preload(c.photos[(pos - 1 + c.photos.length) % c.photos.length].card);
      }

      card.querySelector('.photo-nav.prev').addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); show(-1);
      });
      card.querySelector('.photo-nav.next').addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); show(1);
      });

      wireSwipe(stage, show);

      /* Arrow keys work once the photo itself has focus, which is what
         a keyboard user reaches first — the arrows are skipped over on
         purpose, since they would otherwise be two more stops per card
         between the visitor and the cart details. */
      if (zoom) {
        zoom.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); show(-1); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); show(1); }
        });
      }

      preload(c.photos[1].card);
    });
  }

  function injectSchema(carts) {
    var items = carts.filter(function (c) { return c.status !== 'sold'; }).slice(0, 20).map(function (c, i) {
      var product = {
        '@type': 'Product',
        'name': (c.year ? c.year + ' ' : '') + c.name,
        'category': 'Golf Cart'
      };
      /* Points each list entry at that cart's own page, which carries
         the full Product markup. Without this the listing and the
         detail page look to Google like two unrelated products. */
      var href = window.AGCCartUrl && window.AGCCartUrl(c);
      if (href) product.url = new URL(href, location.origin).href;
      if (c.description) product.description = c.description;
      /* Every photo, not just the first. Google will use more than one
         in a rich result, and these are permanent URLs now — the old
         Airtable ones would have expired long before it fetched them. */
      if (c.photos.length) {
        product.image = c.photos.map(function (p) { return p.full; });
      }
      if (!isNaN(c.priceNum) && c.priceNum > 0) {
        product.offers = {
          '@type': 'Offer',
          'price': String(Math.round(c.priceNum)),
          'priceCurrency': 'USD',
          'availability': c.status === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/LimitedAvailability',
          'itemCondition': c.type === 'Used' ? 'https://schema.org/UsedCondition' : 'https://schema.org/NewCondition',
          'seller': { '@id': 'https://aledogolfcarts.com/#dealer' }
        };
      }
      return { '@type': 'ListItem', 'position': i + 1, 'item': product };
    });
    if (!items.length) return;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': 'Golf Cart Inventory — Aledo Golf Carts',
      'itemListElement': items
    });
    document.head.appendChild(s);
  }

  /* ---------- rendering modes ---------- */

  var state = { carts: [], seats: 'all', type: 'all', sort: 'featured' };

  function sortCarts(list) {
    var statusRank = { available: 0, pending: 1, sold: 2 };
    return list.slice().sort(function (a, b) {
      if (state.sort === 'low') return (a.priceNum || 9e9) - (b.priceNum || 9e9);
      if (state.sort === 'high') return (b.priceNum || 0) - (a.priceNum || 0);
      var s = statusRank[a.status] - statusRank[b.status];
      if (s) return s;
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
    });
  }

  function applyFilters() {
    var grid = document.getElementById('inventory-grid');
    if (!grid) return;
    var list = state.carts.filter(function (c) {
      if (state.seats !== 'all' && String(c.seatsNum) !== state.seats) return false;
      if (state.type !== 'all' && c.type !== state.type) return false;
      return true;
    });
    list = sortCarts(list);
    var count = document.getElementById('inventory-count');
    if (count) count.textContent = list.length + (list.length === 1 ? ' cart' : ' carts');
    if (!list.length) {
      grid.innerHTML = '<div class="inv-empty">No carts match those filters right now — clear a filter or <a href="contact.html" style="color:var(--orange);">tell us what you\'re looking for</a> and we\'ll find it.</div>';
      return;
    }
    grid.innerHTML = list.map(function (c) { return cardHtml(c, state.carts.indexOf(c)); }).join('');
    wirePhotoNav(grid, state.carts);
  }

  function wireFilterBar() {
    var bar = document.getElementById('filter-bar');
    if (!bar) return;
    bar.style.display = '';
    bar.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var group = chip.getAttribute('data-filter');
        state[group] = chip.getAttribute('data-value');
        bar.querySelectorAll('.chip[data-filter="' + group + '"]').forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        applyFilters();
      });
    });
    var sort = document.getElementById('inventory-sort');
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; applyFilters(); });

    // Honor ?seats=4 / ?type=Used links from other pages
    var params = new URLSearchParams(location.search);
    ['seats', 'type'].forEach(function (group) {
      var v = params.get(group);
      if (!v) return;
      var chip = bar.querySelector('.chip[data-filter="' + group + '"][data-value="' + v + '"]');
      if (chip) {
        state[group] = v;
        bar.querySelectorAll('.chip[data-filter="' + group + '"]').forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
      }
    });
  }

  function renderFeatured(carts) {
    var grid = document.getElementById('featured-grid');
    if (!grid) return;
    var picks = carts.filter(function (c) { return c.status === 'available' && c.featured; });
    if (!picks.length) picks = carts.filter(function (c) { return c.status === 'available'; });
    if (!picks.length) return; // keep static fallback
    picks = picks.slice(0, 4);
    grid.innerHTML = picks.map(function (c) { return cardHtml(c, carts.indexOf(c)); }).join('');
    wirePhotoNav(grid, carts);
  }

  /* ---------- boot ---------- */

  if (!AGC_INVENTORY_API) return; // not configured yet — static fallback cards stay

  fetch(AGC_INVENTORY_API, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (payload) {
      var carts = apiToCarts(payload && payload.carts);
      if (!carts.length) return;
      state.carts = carts;

      renderFeatured(carts);

      if (document.getElementById('inventory-grid')) {
        wireFilterBar();
        applyFilters();
        injectSchema(carts);
        var stamp = document.getElementById('inventory-updated');
        if (stamp) stamp.textContent = 'Live inventory · updated ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
    })
    .catch(function (err) {
      // Feed unreachable — leave the static fallback cards in place so
      // visitors never see an error or an empty lot.
      if (window.console) console.warn('Live inventory not loaded:', err.message);
    });
})();
