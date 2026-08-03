/* ═══════════════════════════════════════════════════════════
   ALEDO GOLF CARTS — shared photo behavior

   The inventory grid and each cart's own page both show the same
   photos and open the same full-size viewer, so the viewer lives
   here rather than twice.

   Load this before inventory.js or cart-page.js.

       AGCPhotos.open({ title, photos }, startAt)
       AGCPhotos.preload(url)
       AGCPhotos.wireSwipe(element, onSwipe)

   A photo is { full, card, w, h } — see inventory.js.
   ═══════════════════════════════════════════════════════════ */

window.AGCPhotos = (function () {
  'use strict';

  /* Fetch a photo into the browser cache without showing it, so moving
     to the next one is instant rather than a flash of empty box. */
  var seen = {};
  function preload(url) {
    if (!url || seen[url]) return;
    seen[url] = true;
    var img = new Image();
    img.decoding = 'async';
    img.src = url;
  }

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

  /* ---------- full-size viewer ---------- */

  var lightbox = null;

  function build() {
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

  function open(subject, startAt) {
    if (!subject || !subject.photos || !subject.photos.length) return;

    if (!lightbox) {
      lightbox = build();

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
    lightbox._subject = subject;
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
    if (!lightbox || !lightbox._subject) return;
    var photos = lightbox._subject.photos;
    var at = (Number(lightbox.dataset.at) + delta + photos.length) % photos.length;
    lightbox.dataset.at = String(at);
    render();
  }

  function render() {
    var subject = lightbox._subject;
    var photos = subject.photos;
    var at = Number(lightbox.dataset.at);
    var title = subject.title || '';

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

  return { open: open, close: close, preload: preload, wireSwipe: wireSwipe };
})();
