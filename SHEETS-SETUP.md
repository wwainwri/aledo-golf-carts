# Connect Your Inventory Google Sheet

The inventory page reads directly from a Google Sheet you control. Add a row → the cart shows up on the website. Mark it Sold → the site shows it sold. No code, no uploads.

## One-time setup (about 2 minutes)

1. **Create the sheet.** Go to [sheets.new](https://sheets.new) and put these headers in row 1 (one per column, spelling matters, order doesn't):

   | Name | Year | Price | Seats | Type | Battery | Color | Description | Photos | Status | Featured |
   |------|------|-------|-------|------|---------|-------|-------------|--------|--------|----------|

2. **Share it.** Click **Share** (top right) → under *General access* choose **Anyone with the link** → **Viewer** → Done. (Viewer means the public can only read it — only you can edit.)

3. **Connect it.** Copy the sheet's URL from your browser's address bar. Open `inventory.js` in the website folder and paste the URL between the quotes on this line near the top:

   ```
   var AGC_SHEET_URL = '';
   ```

   becomes

   ```
   var AGC_SHEET_URL = 'https://docs.google.com/spreadsheets/d/YOUR-SHEET-ID/edit';
   ```

4. **Re-upload / redeploy the site.** That's the only time you touch the code — from then on, everything happens in the sheet.

## Filling in rows

| Column | What to enter | Example |
|--------|---------------|---------|
| **Name** | Make & model (required) | Madjax Ascent |
| **Year** | Model year | 2026 |
| **Price** | A number, or text | 12995 — or "Call for pricing" |
| **Seats** | 2, 4, or 6 | 4 |
| **Type** | New or Used | New |
| **Battery** | Battery/power type | Lithium |
| **Color** | Color | Matte Black |
| **Description** | 1–2 sentences for the card | Street-ready with lights, lifted, ready today. |
| **Photos** | Image links, separated by commas or new lines | see below |
| **Status** | Available, Pending, Sold, or Hide | Available |
| **Featured** | "Yes" to show on the homepage | Yes |

### Photos from Google Drive (easiest)

1. Upload cart photos to a folder in Google Drive.
2. Right-click a photo → **Share** → *Anyone with the link* → **Copy link**.
3. Paste the link(s) into the **Photos** cell. Multiple photos: put each link on its own line inside the cell (Ctrl+Enter for a new line) or separate with commas.

The website converts Drive links to images automatically. Any other direct image URL (ending in .jpg, .png, etc.) also works.

### Status meanings

- **Available** — shows normally (this is the default if you leave it blank)
- **Pending** — shows with a "Sale Pending" badge
- **Sold** — stays visible, dimmed, with a "Sold" badge (social proof!) — delete the row when you want it gone
- **Hide** — kept in your sheet, never shown on the site

## Troubleshooting

- **Carts don't appear:** check sharing is "Anyone with the link – Viewer", and the URL in `inventory.js` is the full sheet URL.
- **A photo doesn't show:** make sure that photo file itself is shared "Anyone with the link" (sharing the folder also works).
- **Changes not showing:** the site reads the sheet fresh on every page load — do a hard refresh (Ctrl+Shift+R). Google can take a minute to serve new edits.
- If the sheet is ever unreachable, the site quietly falls back to the built-in sample carts — visitors never see an error.
