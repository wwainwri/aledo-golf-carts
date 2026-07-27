/* Aledo Golf Carts — shared site behavior */

/* Every form (test drive request, part request, cart inquiry) submits here.
   This is the site's own endpoint — netlify/functions/lead.mjs — which
   records the lead in Airtable. Left blank, forms
   fall back to their normal Netlify submission so nothing breaks. */
var AGC_FORMS_ENDPOINT = '/api/lead';

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
