/**
 * ═══════════════════════════════════════════════════════════
 * ALEDO GOLF CARTS — Inventory change broadcaster
 *
 * Lives inside the "Aledo Golf Carts — Website Inventory"
 * Google Sheet (Extensions → Apps Script). The instant a cart
 * row is edited and the edits settle, this script:
 *
 *   1. Figures out WHAT changed (new cart / sold / price drop)
 *   2. Posts it to social media via Post for Me
 *   3. Pings the website's deploy hook (optional — the site
 *      already reads this sheet live on every page load)
 *   4. Optionally emails you a summary
 *
 * ONE-TIME SETUP: fill in CONFIG below, then run setup() once
 * from the toolbar (▶ Run) and approve the authorization
 * prompt. That's it — see SETUP.md for details.
 * ═══════════════════════════════════════════════════════════
 */

var CONFIG = {
  // From postforme.dev → dashboard → API keys. Leave '' to skip social posting.
  POST_FOR_ME_API_KEY: '',

  // Post for Me social account ids to post to, e.g. ['sa_abc123', 'sa_def456']
  // (postforme.dev dashboard → connected accounts). Leave [] to skip.
  POST_FOR_ME_ACCOUNTS: [],

  // Optional: a deploy/build hook URL for the website host (e.g. a Netlify
  // build hook). The site reads this sheet live, so this is usually not
  // needed — leave '' to skip.
  WEBSITE_PING_URL: '',

  // Optional: email a plain-English summary of each change here. '' to skip.
  NOTIFY_EMAIL: '',

  // Wait this many minutes after your LAST edit before broadcasting,
  // so you can finish typing a whole row without firing half-posts.
  QUIET_MINUTES: 3,

  // Cap posts per batch — protects against accidentally pasting 50 rows
  // and spamming every follower you have.
  MAX_POSTS_PER_RUN: 4,

  SHEET_NAME: 'Inventory',
  SITE_URL: 'https://aledogolfcarts.com/inventory.html'
};

/* ───────────────────── SETUP (run once) ───────────────────── */

function setup() {
  // Clear any old triggers for this script, then install fresh ones
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  ScriptApp.newTrigger('processChanges')
    .timeBased()
    .everyMinutes(1)
    .create();

  // Take the first snapshot so existing rows don't fire as "new"
  saveSnapshot_(readCarts_());
  PropertiesService.getScriptProperties().deleteProperty('lastEditAt');

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Inventory broadcaster installed. Edit a cart row and changes go out ' +
    CONFIG.QUIET_MINUTES + ' minutes after your last edit.', 'Aledo Golf Carts', 8);
}

/* ─────────────────────── TRIGGERS ─────────────────────────── */

/** Fires on every edit — just stamps the clock; heavy work happens later. */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getRow() === 1) return; // header edits don't broadcast
  PropertiesService.getScriptProperties().setProperty('lastEditAt', String(Date.now()));
}

/** Runs every minute; broadcasts once edits have been quiet long enough. */
function processChanges() {
  var props = PropertiesService.getScriptProperties();
  var lastEdit = Number(props.getProperty('lastEditAt') || 0);
  if (!lastEdit) return; // nothing pending
  if (Date.now() - lastEdit < CONFIG.QUIET_MINUTES * 60 * 1000) return; // still typing

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var current = readCarts_();
    var previous = loadSnapshot_();
    var events = diffCarts_(previous, current);

    if (events.length) broadcast_(events);

    saveSnapshot_(current);
    props.deleteProperty('lastEditAt');
  } finally {
    lock.releaseLock();
  }
}

/* ─────────────────── READ & DIFF THE SHEET ────────────────── */

function readCarts_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).toLowerCase().trim(); });

  function col(name) { return headers.indexOf(name); }
  var iName = col('name'), iYear = col('year'), iPrice = col('price'),
      iSeats = col('seats'), iColor = col('color'), iStatus = col('status'),
      iPhotos = col('photos'), iDesc = col('description');

  var carts = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = String(row[iName] || '').trim();
    if (!name) continue;

    var status = String(row[iStatus] || 'available').trim().toLowerCase() || 'available';
    if (/hide|hidden|draft/.test(status)) continue; // hidden rows never broadcast

    var color = iColor >= 0 ? String(row[iColor] || '').trim() : '';
    var year = iYear >= 0 ? String(row[iYear] || '').trim() : '';
    var key = (year + ' ' + name + (color ? ' — ' + color : '')).trim();

    carts[key] = {
      title: key,
      price: iPrice >= 0 ? String(row[iPrice] || '').trim() : '',
      seats: iSeats >= 0 ? String(row[iSeats] || '').trim() : '',
      status: /sold/.test(status) ? 'sold' : (/pend/.test(status) ? 'pending' : 'available'),
      photo: iPhotos >= 0 ? firstUrl_(String(row[iPhotos] || '')) : '',
      description: iDesc >= 0 ? String(row[iDesc] || '').trim() : ''
    };
  }
  return carts;
}

function firstUrl_(cell) {
  var m = cell.split(/[\n,|]+/).map(function (s) { return s.trim(); })
    .filter(function (s) { return /^https?:\/\//i.test(s); });
  return m.length ? m[0] : '';
}

function diffCarts_(prev, curr) {
  var events = [];
  Object.keys(curr).forEach(function (key) {
    var now = curr[key], was = prev[key];
    if (!was) {
      if (now.status === 'available') events.push({ type: 'new', cart: now });
      return;
    }
    if (was.status !== 'sold' && now.status === 'sold') {
      events.push({ type: 'sold', cart: now });
      return;
    }
    var oldP = parseFloat(String(was.price).replace(/[$,\s]/g, ''));
    var newP = parseFloat(String(now.price).replace(/[$,\s]/g, ''));
    if (!isNaN(oldP) && !isNaN(newP) && newP < oldP && now.status === 'available') {
      events.push({ type: 'price_drop', cart: now, oldPrice: oldP });
    }
  });
  return events;
}

/* ──────────────────────── BROADCAST ───────────────────────── */

function broadcast_(events) {
  var toPost = events.slice(0, CONFIG.MAX_POSTS_PER_RUN);
  var results = [];

  toPost.forEach(function (ev) {
    var caption = captionFor_(ev);
    var social = sendToPostForMe_(caption, ev.cart.photo);
    results.push({ event: ev, caption: caption, social: social });
  });

  var sitePing = pingWebsite_();

  if (CONFIG.NOTIFY_EMAIL) {
    var lines = results.map(function (r) {
      return '• [' + r.event.type.toUpperCase() + '] ' + r.event.cart.title +
             ' — social: ' + r.social + '\n  ' + r.caption.split('\n')[0];
    });
    if (events.length > toPost.length) {
      lines.push('(' + (events.length - toPost.length) + ' more change(s) detected but not posted — over the per-run cap.)');
    }
    lines.push('Website ping: ' + sitePing);
    MailApp.sendEmail(CONFIG.NOTIFY_EMAIL,
      'Inventory update broadcast — Aledo Golf Carts',
      lines.join('\n\n') + '\n\nSheet-driven inventory is already live at ' + CONFIG.SITE_URL);
  }
}

function captionFor_(ev) {
  var c = ev.cart;
  var price = priceText_(c.price);
  var seats = c.seats ? c.seats + '-passenger' : '';

  if (ev.type === 'new') {
    return '🚨 Just landed at Aledo Golf Carts: ' + c.title + (seats ? ' — ' + seats : '') +
      (price ? ', ' + price : '') + '.\n' +
      (c.description ? c.description + '\n' : '') +
      '📍 10200 E Bankhead Hwy, Aledo TX · (817) 776-2175\n' +
      'See it before it’s gone: ' + CONFIG.SITE_URL;
  }
  if (ev.type === 'sold') {
    return '✅ SOLD! The ' + c.title + ' found its new home. ' +
      'Congrats to the new owners! 🎉\n' +
      'Don’t miss the next one — current inventory: ' + CONFIG.SITE_URL;
  }
  // price_drop
  return '💰 Price drop: ' + c.title + ' is now ' + price +
    (ev.oldPrice ? ' (was $' + Math.round(ev.oldPrice).toLocaleString() + ')' : '') + '.\n' +
    '📍 Aledo Golf Carts · (817) 776-2175\n' + CONFIG.SITE_URL;
}

function priceText_(p) {
  var n = parseFloat(String(p).replace(/[$,\s]/g, ''));
  return isNaN(n) ? String(p || '') : '$' + Math.round(n).toLocaleString();
}

/** Post to social via Post for Me (api.postforme.dev). */
function sendToPostForMe_(caption, photoUrl) {
  if (!CONFIG.POST_FOR_ME_API_KEY || !CONFIG.POST_FOR_ME_ACCOUNTS.length) return 'skipped (not configured)';
  try {
    var body = {
      social_accounts: CONFIG.POST_FOR_ME_ACCOUNTS,
      caption: caption
    };
    if (photoUrl) body.media = [{ url: photoUrl }];

    var res = UrlFetchApp.fetch('https://api.postforme.dev/v1/social-posts', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + CONFIG.POST_FOR_ME_API_KEY },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return (code >= 200 && code < 300) ? 'posted ✓' : 'HTTP ' + code + ': ' + res.getContentText().slice(0, 200);
  } catch (err) {
    return 'error: ' + err.message;
  }
}

/** Ping the website's deploy hook, if one is configured. */
function pingWebsite_() {
  if (!CONFIG.WEBSITE_PING_URL) return 'skipped (site reads the sheet live — no ping needed)';
  try {
    var res = UrlFetchApp.fetch(CONFIG.WEBSITE_PING_URL, { method: 'post', muteHttpExceptions: true, payload: '{}' });
    return 'HTTP ' + res.getResponseCode();
  } catch (err) {
    return 'error: ' + err.message;
  }
}

/* ─────────────────────── SNAPSHOT STORE ───────────────────── */

function loadSnapshot_() {
  var raw = PropertiesService.getScriptProperties().getProperty('inventorySnapshot');
  return raw ? JSON.parse(raw) : {};
}

function saveSnapshot_(carts) {
  PropertiesService.getScriptProperties().setProperty('inventorySnapshot', JSON.stringify(carts));
}

/* ──────────────────────── TEST HELPERS ────────────────────── */

/** Run this to preview what WOULD be broadcast right now, without sending. */
function dryRun() {
  var events = diffCarts_(loadSnapshot_(), readCarts_());
  if (!events.length) {
    Logger.log('No changes detected vs. the stored snapshot.');
    return;
  }
  events.forEach(function (ev) {
    Logger.log('--- ' + ev.type.toUpperCase() + ' ---\n' + captionFor_(ev) +
      (ev.cart.photo ? '\n[photo] ' + ev.cart.photo : '\n[no photo]'));
  });
}

/** Run this to re-baseline the snapshot without broadcasting anything. */
function resyncSnapshot() {
  saveSnapshot_(readCarts_());
  PropertiesService.getScriptProperties().deleteProperty('lastEditAt');
  Logger.log('Snapshot re-baselined. Current sheet state is now "already announced."');
}
