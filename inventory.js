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
     photos       array of image links
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

  /* Convert Google Drive share links into direct image URLs */
  function driveToImage(url) {
    var m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/) ||
            url.match(/drive\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200';
    return url;
  }

  function parsePhotos(list) {
    if (!list) return [];
    return (Array.isArray(list) ? list : String(list).split(/[\n,|]+/))
      .map(function (s) { return String(s).trim(); })
      .filter(function (s) { return /^https?:\/\//i.test(s); })
      .map(driveToImage);
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
        photos: parsePhotos(r.photos),
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
      photo = '<img class="cart-img" src="' + esc(c.photos[0]) + '" alt="' + title + ' golf cart at Aledo Golf Carts" loading="lazy" onerror="this.closest(\'.cart-photo\').innerHTML=\'<img class=cart-placeholder src=assets/logo.png alt=\\\'\\\'>\';" />';
      if (c.photos.length > 1) {
        photo += '<button class="photo-nav prev" aria-label="Previous photo">&#8249;</button>' +
                 '<button class="photo-nav next" aria-label="Next photo">&#8250;</button>' +
                 '<span class="photo-count">1 / ' + c.photos.length + '</span>';
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

  function wirePhotoNav(grid, carts) {
    grid.querySelectorAll('.cart-card').forEach(function (card) {
      var c = carts[+card.dataset.idx];
      if (!c || c.photos.length < 2) return;
      var pos = 0;
      var img = card.querySelector('.cart-img');
      var count = card.querySelector('.photo-count');
      function show(delta) {
        pos = (pos + delta + c.photos.length) % c.photos.length;
        img.src = c.photos[pos];
        if (count) count.textContent = (pos + 1) + ' / ' + c.photos.length;
      }
      var prev = card.querySelector('.photo-nav.prev');
      var next = card.querySelector('.photo-nav.next');
      if (prev) prev.addEventListener('click', function (e) { e.preventDefault(); show(-1); });
      if (next) next.addEventListener('click', function (e) { e.preventDefault(); show(1); });
    });
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
      if (c.photos.length) product.image = c.photos[0];
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
