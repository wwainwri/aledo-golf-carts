/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — Google Sheets inventory loader

   HOW TO CONNECT YOUR SHEET (one-time setup, ~2 minutes):
   1. Open your inventory Google Sheet.
   2. Click Share → General access → "Anyone with the link" → Viewer.
   3. Copy the sheet's URL from your browser address bar.
   4. Paste it between the quotes in AGC_SHEET_URL below.

   The first row of the sheet must be headers. Recognized columns
   (capitalization doesn't matter, extra columns are ignored):

   Name | Year | Price | Seats | Type | Battery | Color | Description | Photos | Status | Featured

   - Name:        e.g. "Madjax Ascent"  (required — rows without a name are skipped)
   - Year:        e.g. 2026
   - Price:       a number like 12995, or text like "Call for pricing"
   - Seats:       2, 4, or 6
   - Type:        New or Used
   - Battery:     e.g. Lithium, Lead-Acid, Gas
   - Color:       e.g. Matte Black
   - Description: one or two sentences shown on the card
   - Photos:      one or more image links, separated by commas or new lines.
                  Google Drive share links work — right-click the image in
                  Drive → Share → "Anyone with the link" → copy link, paste it here.
   - Status:      Available (default), Pending, Sold, or Hide
   - Featured:    Yes to show the cart on the homepage

   See SHEETS-SETUP.md in this folder for a copy-paste template.
   ═══════════════════════════════════════════════════════════ */

var AGC_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1TFkeLQidL0K1GXOIa46lHA8DDeWK7apqQgpfkMuSHos/edit?gid=0#gid=0';

(function () {
  'use strict';

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toCsvUrl(url) {
    if (!url) return '';
    url = url.trim();
    // Already a published-to-web CSV link
    if (/\/spreadsheets\/d\/e\//.test(url)) {
      if (/output=csv/.test(url)) return url;
      return url.replace(/\/pub.*$/, '/pub?output=csv');
    }
    // Regular sheet URL → CSV export endpoint (works when sharing = anyone with link)
    var m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) {
      var gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
      return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : '');
    }
    return url;
  }

  /* Proper CSV parser: quotes, embedded commas and newlines */
  function parseCsv(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return v.trim() !== ''; }); });
  }

  /* Convert Google Drive share links into direct image URLs */
  function driveToImage(url) {
    var m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/) ||
            url.match(/drive\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200';
    return url;
  }

  function parsePhotos(cell) {
    if (!cell) return [];
    return cell.split(/[\n,|]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return /^https?:\/\//i.test(s); })
      .map(driveToImage);
  }

  function normHeader(h) {
    h = h.toLowerCase().trim();
    if (/^(name|model|title|cart)$/.test(h)) return 'name';
    if (/^year$/.test(h)) return 'year';
    if (/^price/.test(h)) return 'price';
    if (/^(seats?|passengers?|seating)/.test(h)) return 'seats';
    if (/^(type|condition|new.?used)/.test(h)) return 'type';
    if (/^batter/.test(h)) return 'battery';
    if (/^colou?r$/.test(h)) return 'color';
    if (/^(description|notes|details)/.test(h)) return 'description';
    if (/^(photos?|images?|pictures?)/.test(h)) return 'photos';
    if (/^status$/.test(h)) return 'status';
    if (/^featured/.test(h)) return 'featured';
    return null;
  }

  function rowsToCarts(rows) {
    var headers = rows[0].map(normHeader);
    return rows.slice(1).map(function (r) {
      var c = {};
      headers.forEach(function (h, i) { if (h) c[h] = (r[i] || '').trim(); });
      if (!c.name) return null;
      c.photos = parsePhotos(c.photos);
      c.status = (c.status || 'available').toLowerCase();
      if (/^hide|hidden|draft$/.test(c.status)) return null;
      if (/pend/.test(c.status)) c.status = 'pending';
      else if (/sold/.test(c.status)) c.status = 'sold';
      else c.status = 'available';
      c.featured = /^(y|yes|true|1|x)$/i.test(c.featured || '');
      c.priceNum = parseFloat(String(c.price).replace(/[$,\s]/g, ''));
      c.seatsNum = parseInt(c.seats, 10) || null;
      c.type = /used|pre.?owned/i.test(c.type || '') ? 'Used' : (/new/i.test(c.type || '') ? 'New' : '');
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

  var csvUrl = toCsvUrl(AGC_SHEET_URL);
  if (!csvUrl) return; // not configured yet — static fallback cards stay

  fetch(csvUrl)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (text) {
      var carts = rowsToCarts(parseCsv(text));
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
      // Sheet unreachable — leave the static fallback in place, visitors see no error
      if (window.console) console.warn('Inventory sheet not loaded:', err.message);
    });
})();
