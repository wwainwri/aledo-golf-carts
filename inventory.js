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

  /* Every photo arrives in one shape:

       full   the big version, for the lightbox
       card   what the grid should load — smaller when that helps
       w, h   intrinsic size, so the page can reserve the space */
  function normalisePhotos(record) {
    var gallery = (record && record.gallery) || [];
    if (!Array.isArray(gallery)) return [];

    return gallery
      .filter(function (p) { return p && p.full; })
      .map(function (p) {
        return {
          full: p.full,
          card: p.card || p.full,
          w: Number(p.width) || 0,
          h: Number(p.height) || 0
        };
      });
  }

  /* The endpoint already normalises names, statuses, and the featured
     checkbox, and drops hidden carts. All that is left is the derived
     values the cards and filters need. */
  function apiToCarts(records) {
    return (records || []).map(function (r) {
      if (!r || !r.name) return null;
      var c = {
        name: r.name,
        year: r.year || '',
        price: r.price || '',
        seats: r.seats || '',
        battery: r.battery || '',
        color: r.color || '',
        description: r.description || '',
        photos: normalisePhotos(r),
        status: r.status === 'pending' || r.status === 'sold' ? r.status : 'available',
        featured: r.featured === true
      };
      c.priceNum = parseFloat(String(c.price).replace(/[$,\s]/g, ''));
      c.seatsNum = parseInt(c.seats, 10) || null;
      c.type = /used|pre.?owned/i.test(r.type || '') ? 'Used' : (/new/i.test(r.type || '') ? 'New' : '');
      return c;
    }).filter(Boolean);
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

    var ask = c.status === 'sold'
      ? ''
      : '<div class="cart-ask"><a class="btn-primary" href="#inquiry" data-cart="' + title + '">Ask About This Cart</a></div>';

    return '<div class="cart-card fade-up visible' + (c.status === 'sold' ? ' sold' : '') + '" data-idx="' + idx + '">' +
      '<div class="cart-photo">' + photo + '<div class="cart-badges">' + badges + '</div></div>' +
      '<div class="cart-body">' +
        '<h3>' + title + '</h3>' +
        '<div class="cart-price">' + priceHtml(c) + '</div>' +
        chipHtml +
        (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        ask +
      '</div>' +
    '</div>';
  }

  /* Fetch a photo into the browser cache without showing it, so moving
     to the next one is instant rather than a flash of empty box. */
  function preload(url) {
    if (!url || preload.seen[url]) return;
    preload.seen[url] = true;
    var img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
  preload.seen = {};

  /* Treats a horizontal drag as next/previous, and deliberately ignores
     a mostly-vertical one so the page can still be scrolled with a
     thumb that happens to start on a photo. */
  function wireSwipe(el, onSwipe) {
    var startX = 0, startY = 0, tracking = false;

    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    el.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var touch = e.changedTouches[0];
      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      onSwipe(dx < 0 ? 1 : -1);
    }, { passive: true });
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

  /* ---------- full-size viewer ---------- */

  var lightbox = null;

  function buildLightbox() {
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Cart photos');
    box.innerHTML =
      '<button class="lb-close" aria-label="Close photos">&times;</button>' +
      '<button class="lb-nav prev" aria-label="Previous photo">&#8249;</button>' +
      '<figure class="lb-stage"><img alt="" /></figure>' +
      '<button class="lb-nav next" aria-label="Next photo">&#8250;</button>' +
      '<div class="lb-bar"><span class="lb-title"></span><span class="lb-count"></span></div>';
    document.body.appendChild(box);
    return box;
  }

  function openLightbox(cart, startAt) {
    if (!lightbox) {
      lightbox = buildLightbox();

      lightbox.addEventListener('click', function (e) {
        /* Clicking the backdrop closes; clicking a control does not. */
        if (e.target === lightbox || e.target.classList.contains('lb-stage')) close();
      });
      lightbox.querySelector('.lb-close').addEventListener('click', close);
      lightbox.querySelector('.lb-nav.prev').addEventListener('click', function () { step(-1); });
      lightbox.querySelector('.lb-nav.next').addEventListener('click', function () { step(1); });
      wireSwipe(lightbox, step);

      document.addEventListener('keydown', function (e) {
        if (!lightbox.classList.contains('open')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
      });
    }

    lightbox.dataset.at = String(startAt || 0);
    lightbox._cart = cart;
    lightbox.classList.add('open');

    /* Stop the page behind from scrolling under the overlay. */
    document.body.style.overflow = 'hidden';

    render();
    lightbox.querySelector('.lb-close').focus();
  }

  function close() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  function step(delta) {
    if (!lightbox || !lightbox._cart) return;
    var photos = lightbox._cart.photos;
    var at = (Number(lightbox.dataset.at) + delta + photos.length) % photos.length;
    lightbox.dataset.at = String(at);
    render();
  }

  function render() {
    var cart = lightbox._cart;
    var photos = cart.photos;
    var at = Number(lightbox.dataset.at);
    var title = (cart.year ? cart.year + ' ' : '') + cart.name;

    var img = lightbox.querySelector('.lb-stage img');
    img.src = photos[at].full;
    img.alt = title + ' golf cart, photo ' + (at + 1) + ' of ' + photos.length;

    lightbox.querySelector('.lb-title').textContent = title;
    lightbox.querySelector('.lb-count').textContent = photos.length > 1
      ? (at + 1) + ' / ' + photos.length : '';

    var single = photos.length < 2;
    lightbox.querySelectorAll('.lb-nav').forEach(function (b) { b.style.display = single ? 'none' : ''; });

    if (!single) {
      preload(photos[(at + 1) % photos.length].full);
      preload(photos[(at - 1 + photos.length) % photos.length].full);
    }
  }

  function wireAskButtons(grid) {
    grid.querySelectorAll('[data-cart]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = document.getElementById('inquiry-cart');
        if (field) field.value = btn.getAttribute('data-cart');
      });
    });
  }

  function injectSchema(carts) {
    var items = carts.filter(function (c) { return c.status !== 'sold'; }).slice(0, 20).map(function (c, i) {
      var product = {
        '@type': 'Product',
        'name': (c.year ? c.year + ' ' : '') + c.name,
        'category': 'Golf Cart'
      };
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
    wireAskButtons(grid);
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
    // On the homepage, "ask" buttons go to the contact section
    grid.querySelectorAll('[data-cart]').forEach(function (btn) {
      btn.setAttribute('href', 'contact.html');
    });
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
