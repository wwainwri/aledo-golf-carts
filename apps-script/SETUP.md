# Inventory Change Broadcaster — Setup

The script in `Code.gs` lives inside the inventory Google Sheet. The moment a cart row is edited (and the edits go quiet for a few minutes), it works out what changed and announces it:

| You do this in the sheet | Followers/website see this |
|---|---|
| Add a row (Status: Available) | "🚨 Just landed at Aledo Golf Carts: 2026 Madjax Ascent — Blue, $13,995…" with the cart photo |
| Change Status to **Sold** | "✅ SOLD! The 2026 Teko Trophy found its new home…" |
| Lower a price | "💰 Price drop: … is now $12,495 (was $12,995)" |
| Anything else (typos, descriptions, photos) | Nothing posts — the website just updates, since it reads the sheet live |

Built-in guardrails: it waits **3 quiet minutes** after your last edit so half-typed rows never post; it caps at **4 posts per batch** so pasting a bulk of rows can't spam your followers; Hide rows never broadcast; and the first install "baselines" the sheet so existing carts aren't announced as new.

## Install (already done if Claude set it up)

1. Open the inventory sheet → **Extensions → Apps Script**.
2. Paste the contents of `Code.gs` over the default file, and save (Ctrl+S).

## Configure & authorize (you do this — ~3 minutes)

1. In the Apps Script editor, fill in the `CONFIG` block at the top:
   - **POST_FOR_ME_API_KEY** — from [postforme.dev](https://www.postforme.dev/) → dashboard → API keys.
   - **POST_FOR_ME_ACCOUNTS** — the `sa_…` ids of the connected Facebook/Instagram/etc. accounts you want posts on (Post for Me dashboard → accounts).
   - **NOTIFY_EMAIL** — optional; get an email receipt of every broadcast.
   - **WEBSITE_PING_URL** — leave blank. The website reads the sheet live on every page load, so it needs no push. (If the site ever moves to a host with build hooks, paste the hook URL here.)
2. In the toolbar, pick the function **`setup`** and click **▶ Run**.
3. Google will ask you to authorize the script (it needs permission to watch this sheet, call the Post for Me API, and send you email). Click **Review permissions → your account → Allow**. This is Google's standard prompt for any sheet script.

Done. From then on it's fully automatic.

## Testing without posting anything

- Pick **`dryRun`** in the toolbar and Run — the log (View → Logs) shows exactly what *would* be posted right now, without sending.
- Made a mess of the sheet and don't want it announced? Run **`resyncSnapshot`** — it marks the current sheet state as "already announced" and moves on.

## How it decides what changed

Every run compares the sheet against a stored snapshot of the last announced state, keyed by *year + name + color*. That means edits are detected reliably even if you sort rows, insert rows in the middle, or fix a typo — only real events (new cart, sold, price drop) fire posts.
