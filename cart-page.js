/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — one cart's own page

   Draws the page at /carts/<slug>-<record id> into cart.html.

   Two ways in, and they matter for different reasons:

     • Normally the server has already looked the cart up and put it
       in window.AGC_CART, so the page draws with no fetch and no
       flicker — and, more to the point, the title and link-preview
       image are in the HTML before this file runs, which is the only
       way Facebook and iMessage ever see them.

     • Opened directly as /cart.html?id=recXXXX there is no injected
       cart, so this fetches the same /api/inventory feed the listing
       grid reads and finds it. That is what makes the page previewable
       without running the function locally.

   Either way the source of truth is Airtable: what the owner changes
   in the dashboard is what this page shows.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var PHONE = '(817) 207-7044';
  var PHONE_HREF = 'tel:+18172077044';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function titleOf(c) {
    return (c.year ? c.year + ' ' : '') + c.name;
  }

  /* The record id is the last dash-separated piece of the address —
     everything before it is wording for people and search results. */
  function idFromLocation() {
    var params = new URLSearchParams(location.search);
    var explicit = params.get('id');
    if (explicit) return explicit;
    var match = location.pathname.match(/(rec[A-Za-z0-9]{10,20})\/?$/);
    return match ? match[1] : '';
  }

  /* ---------- the cart itself ---------- */

  function priceBlock(c) {
    if (!isNaN(c.priceNum) && c.priceNum > 0) {
      var monthly = '/financing.html?price=' +
        encodeURIComponent(Math.round(c.priceNum)) + '#tools';
      return '<div class="cd-price">$' + Math.round(c.priceNum).toLocaleString() + '</div>' +
        '<p class="cd-price-note">Plus tax, title, and any dealer fees. ' +
        '<a href="' + monthly + '">See what this looks like monthly →</a></p>';
    }
    return '<div class="cd-price"><span>' + (esc(c.price) || 'Call for pricing') + '</span></div>' +
      '<p class="cd-price-note">Give us a call and we\'ll talk numbers.</p>';
  }

  function specsHtml(c) {
    var rows = [];
    if (c.type) rows.push(['Condition', c.type]);
    if (c.seatsNum) rows.push(['Seating', c.seatsNum + '-passenger']);
    if (c.battery) rows.push(['Power', c.battery]);
    if (c.color) rows.push(['Color', c.color]);
    if (c.year) rows.push(['Model year', c.year]);
    if (!rows.length) return '';
    return '<dl class="cd-specs">' + rows.map(function (r) {
      return '<div class="cd-spec"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function galleryHtml(c, title) {
    if (!c.photos.length) {
      return '<div class="cd-stage"><img class="cart-placeholder" src="/assets/logo.png" alt="" /></div>' +
        '<p class="cd-price-note" style="margin-top:0.7rem;">Photos of this one are on the way — call us and we\'ll send them over.</p>';
    }

    var first = c.photos[0];
    var size = first.w && first.h ? ' width="' + first.w + '" height="' + first.h + '"' : '';
    var stage = '<div class="cd-stage">' +
      '<img class="cd-photo" src="' + esc(first.full) + '"' + size +
      ' alt="' + esc(title) + ' golf cart at Aledo Golf Carts" fetchpriority="high" decoding="async" />' +
      '<button class="cd-zoom" aria-label="View ' + esc(title) + ' photos full size"></button>';

    if (c.photos.length > 1) {
      stage += '<button class="photo-nav prev" aria-label="Previous photo">&#8249;</button>' +
        '<button class="photo-nav next" aria-label="Next photo">&#8250;</button>' +
        '<span class="photo-count"><span class="photo-at">1</span> / ' + c.photos.length + '</span>';
    }
    stage += '</div>';

    if (c.photos.length < 2) return stage;

    var thumbs = c.photos.map(function (p, i) {
      return '<button class="cd-thumb' + (i === 0 ? ' on' : '') + '" data-at="' + i + '" ' +
        'aria-label="Show photo ' + (i + 1) + '">' +
        '<img src="' + esc(p.card) + '" alt="" loading="lazy" decoding="async" /></button>';
    }).join('');

    return stage + '<div class="cd-thumbs">' + thumbs + '</div>';
  }

  function actionsHtml(c, title) {
    if (c.status === 'sold') {
      return '<div class="cd-sold-note"><strong>This one has sold.</strong> Carts like it come through ' +
        'regularly — tell us what you\'re after and we\'ll call you when the next one lands.</div>' +
        '<div class="cd-actions">' +
        '<a class="btn-primary" href="#inquiry">Find Me One Like This</a>' +
        '<a class="btn-outline-dark" href="/inventory.html">See What\'s On The Lot</a>' +
        '</div>';
    }

    var pending = c.status === 'pending'
      ? '<div class="cd-sold-note" style="border-left-color:#B98212;"><strong>Sale pending.</strong> ' +
        'A deal is in progress on this one, but they do fall through — ask us to keep you posted.</div>'
      : '';

    return pending +
      '<div class="cd-actions">' +
      '<a class="btn-primary" href="#inquiry">Ask About This Cart</a>' +
      '<a class="btn-outline-dark" href="' + PHONE_HREF + '">Call ' + PHONE + '</a>' +
      '</div>' +
      '<ul class="cd-reassure">' +
      '<li>Come drive it — we\'re on E Bankhead Hwy in Aledo, no appointment needed Mon–Fri.</li>' +
      '<li>Financing available, and we\'ll take your current cart in on trade.</li>' +
      '<li>Serviced and road-ready before it leaves the lot.</li>' +
      '</ul>';
  }

  function detailHtml(c) {
    var title = titleOf(c);

    var badges = '';
    if (c.status === 'sold') badges = '<span class="badge badge-sold">Sold</span>';
    else if (c.status === 'pending') badges = '<span class="badge badge-pending">Sale Pending</span>';
    else if (c.type) badges = '<span class="badge' + (c.type === 'Used' ? ' badge-used' : '') + '">' + esc(c.type) + '</span>';

    return '<div class="cart-detail">' +
      '<div class="cd-gallery">' + galleryHtml(c, title) + '</div>' +
      '<div class="cd-info">' +
        (badges ? '<div class="cart-badges">' + badges + '</div>' : '') +
        '<h1>' + esc(title) + '</h1>' +
        priceBlock(c) +
        specsHtml(c) +
        /* The full write-up belongs on the cart's own page — the short
           version is for the grid this page was clicked through from. */
        ((c.longDescription || c.description) ? '<p class="cd-desc">' + esc(c.longDescription || c.description) + '</p>' : '') +
        actionsHtml(c, title) +
      '</div>' +
    '</div>';
  }

  function wireGallery(root, c) {
    var title = titleOf(c);
    var zoom = root.querySelector('.cd-zoom');
    var at = 0;

    if (zoom) {
      zoom.addEventListener('click', function () {
        window.AGCPhotos.open({ title: title, photos: c.photos }, at);
      });
    }

    if (c.photos.length < 2) return;

    var img = root.querySelector('.cd-photo');
    var counter = root.querySelector('.photo-at');
    var thumbs = root.querySelectorAll('.cd-thumb');

    function show(next) {
      at = (next + c.photos.length) % c.photos.length;
      img.src = c.photos[at].full;
      if (counter) counter.textContent = String(at + 1);
      thumbs.forEach(function (t, i) { t.classList.toggle('on', i === at); });
      /* Whichever way they are going, the one after next is likely. */
      window.AGCPhotos.preload(c.photos[(at + 1) % c.photos.length].full);
      window.AGCPhotos.preload(c.photos[(at - 1 + c.photos.length) % c.photos.length].full);
    }

    root.querySelector('.photo-nav.prev').addEventListener('click', function () { show(at - 1); });
    root.querySelector('.photo-nav.next').addEventListener('click', function () { show(at + 1); });
    thumbs.forEach(function (t) {
      t.addEventListener('click', function () { show(Number(t.dataset.at)); });
    });
    window.AGCPhotos.wireSwipe(root.querySelector('.cd-stage'), function (delta) { show(at + delta); });

    window.AGCPhotos.preload(c.photos[1].full);
  }

  /* ---------- more from the lot ---------- */

  function relatedCardHtml(c) {
    var title = titleOf(c);
    var href = window.AGCCartUrl(c);
    var photo = c.photos.length
      ? '<img class="cart-img" src="' + esc(c.photos[0].card) + '" alt="' + esc(title) +
        ' golf cart at Aledo Golf Carts" loading="lazy" decoding="async" />'
      : '<img class="cart-placeholder" src="/assets/logo.png" alt="" />';

    var price = !isNaN(c.priceNum) && c.priceNum > 0
      ? '$' + Math.round(c.priceNum).toLocaleString()
      : '<span>' + (esc(c.price) || 'Call for pricing') + '</span>';

    var chips = [];
    if (c.seatsNum) chips.push(c.seatsNum + '-Passenger');
    if (c.battery) chips.push(esc(c.battery));

    return '<div class="cart-card fade-up visible">' +
      '<div class="cart-photo">' + photo +
        (c.type ? '<div class="cart-badges"><span class="badge' + (c.type === 'Used' ? ' badge-used' : '') +
          '">' + esc(c.type) + '</span></div>' : '') +
      '</div>' +
      '<div class="cart-body">' +
        '<h3><a href="' + esc(href) + '">' + esc(title) + '</a></h3>' +
        '<div class="cart-price">' + price + '</div>' +
        (chips.length ? '<div class="cart-specs">' + chips.map(function (s) {
          return '<span class="spec-chip">' + s + '</span>';
        }).join('') + '</div>' : '') +
        '<div class="cart-ask"><a class="btn-primary" href="' + esc(href) + '">View Details</a></div>' +
      '</div>' +
    '</div>';
  }

  /* Carts with the same seat count first: someone looking at a six-seater
     is shopping for room, not for a bargain two-seater. */
  function renderRelated(carts, current) {
    var section = document.getElementById('related-section');
    var grid = document.getElementById('related-grid');
    if (!section || !grid) return;

    var others = carts.filter(function (c) {
      return c.id !== current.id && c.status === 'available';
    });
    if (!others.length) return;

    others.sort(function (a, b) {
      var same = (b.seatsNum === current.seatsNum ? 1 : 0) - (a.seatsNum === current.seatsNum ? 1 : 0);
      if (same) return same;
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
    });

    grid.innerHTML = others.slice(0, 3).map(relatedCardHtml).join('');
    section.hidden = false;
  }

  /* ---------- schema.org ---------- */

  /* Only when the server has not already written it into the HTML —
     which it has for every real visit. This covers the direct
     /cart.html?id=… address so the two never disagree. */
  function injectSchema(c) {
    if (document.querySelector('script[type="application/ld+json"]')) return;

    var product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': titleOf(c),
      'category': 'Golf Cart',
      'url': location.href
    };
    if (c.longDescription || c.description) product.description = c.longDescription || c.description;
    if (c.color) product.color = c.color;
    if (c.photos.length) product.image = c.photos.map(function (p) { return p.full; });
    if (!isNaN(c.priceNum) && c.priceNum > 0) {
      product.offers = {
        '@type': 'Offer',
        'price': String(Math.round(c.priceNum)),
        'priceCurrency': 'USD',
        'availability': c.status === 'sold'
          ? 'https://schema.org/SoldOut'
          : (c.status === 'pending' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/InStock'),
        'itemCondition': c.type === 'Used' ? 'https://schema.org/UsedCondition' : 'https://schema.org/NewCondition',
        'seller': { '@id': 'https://aledogolfcarts.com/#dealer' }
      };
    }

    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(product);
    document.head.appendChild(s);
  }

  /* ---------- page ---------- */

  function message(html) {
    var root = document.getElementById('cart-detail');
    if (root) root.innerHTML = '<div class="cd-message">' + html + '</div>';
  }

  function gone() {
    document.title = 'Cart not found | Aledo Golf Carts';
    message(
      '<h1>That cart isn\'t on the lot.</h1>' +
      '<p>It may have sold, or the link may be out of date. Here\'s everything we have right now.</p>' +
      '<a class="btn-primary" href="/inventory.html">See current inventory</a>'
    );
  }

  function render(cart, all) {
    var root = document.getElementById('cart-detail');
    var title = titleOf(cart);

    root.innerHTML = detailHtml(cart);
    wireGallery(root, cart);

    var crumb = document.getElementById('crumb-cart');
    if (crumb) crumb.textContent = title;

    /* Set only when the server has not — it renders the real title into
       the HTML, which is the copy search engines and Facebook read. */
    if (/^Golf Cart Details/.test(document.title)) {
      document.title = title + ' | Aledo Golf Carts';
    }

    var field = document.getElementById('inquiry-cart');
    if (field) field.value = title;

    injectSchema(cart);
    if (all) renderRelated(all, cart);
  }

  /* ---------- boot ---------- */

  var injected = window.AGC_CART && window.AGCCartFromApi(window.AGC_CART);
  if (injected) render(injected);

  var wanted = injected ? injected.id : idFromLocation();
  if (!wanted) { gone(); return; }

  /* Even when the cart came down in the HTML this still runs, because the
     related carts are not injected — and it costs nothing extra, since the
     feed is already at the edge for the listing page. */
  fetch('/api/inventory', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (payload) {
      var carts = (payload && payload.carts || []).map(window.AGCCartFromApi).filter(Boolean);
      var cart = carts.filter(function (c) { return c.id === wanted; })[0];
      if (!cart) {
        if (!injected) gone();
        return;
      }
      if (!injected) render(cart, carts);
      else renderRelated(carts, cart);
    })
    .catch(function (err) {
      if (window.console) console.warn('Cart not loaded:', err.message);
      if (injected) return; // the injected copy is already on screen
      message(
        '<h1>We couldn\'t load this cart.</h1>' +
        '<p>Give it a moment and try again, or call us on <a href="' + PHONE_HREF +
        '" style="color:var(--orange);">' + PHONE + '</a> and we\'ll tell you about it.</p>' +
        '<a class="btn-primary" href="/inventory.html">See current inventory</a>'
      );
    });
})();
