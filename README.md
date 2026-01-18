# Vida Verde Storefront

Premium sourkrout and microgreen nourishment, built with Next.js + Supabase.

## Quick Start

1) Install dependencies.

```bash
npm install
```

2) Create `.env.local` from `.env.example` and fill in the values.

3) Run the dev server.

```bash
npm run dev
```

## Stock Sync (Google Sheets)

The storefront reads live inventory from a public CSV export of your Google Sheet.
Orders can also write stock, preorder, and sales counts back to the sheet via
Google Apps Script (status and restock date columns are ignored).

Supported formats:
- Header-based: columns named `sku` (or `name`) and `stock`, with optional `preorders` and `sales`.
- Fixed layout: names start in column B row 5, stock in column C row 5, preorders in column E row 5, and total sales in column G row 5.
  - Names in column B are shown on the storefront.

Example CSV URL format:
```
https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?tqx=out:csv
```

Write-back requirements (for sales to decrement stock and increment totals):
- Deploy the Apps Script below as a web app and copy its URL.
- Set these environment variables:
  - `GOOGLE_APPS_SCRIPT_URL`
  - `GOOGLE_APPS_SCRIPT_TOKEN` (optional shared secret)

Apps Script (bound to your sheet):
```javascript
const SHEET_NAME = "Sheet1";

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");
  const expectedToken = PropertiesService.getScriptProperties().getProperty("TOKEN");

  if (expectedToken && payload.token !== expectedToken) {
    return ContentService.createTextOutput("Unauthorized").setMimeType(
      ContentService.MimeType.TEXT
    );
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return ContentService.createTextOutput("Missing sheet").setMimeType(
      ContentService.MimeType.TEXT
    );
  }

  const updates = Array.isArray(payload.updates) ? payload.updates : [];
  const columns = payload.columns || { stock: "C", preorders: "E", sales: "G" };

  updates.forEach((update) => {
    sheet.getRange(`${columns.stock}${update.row}`).setValue(update.stock);
    sheet.getRange(`${columns.preorders}${update.row}`).setValue(update.preorders);
    sheet.getRange(`${columns.sales}${update.row}`).setValue(update.sales);
  });

  return ContentService.createTextOutput("ok").setMimeType(
    ContentService.MimeType.TEXT
  );
}
```

Set the `TOKEN` script property if you use `GOOGLE_APPS_SCRIPT_TOKEN`.

SKUs used by the site (match these in your sheet or list the product names in column B):
- `VV-VERDANT-01`
- `VV-CITRUS-02`
- `VV-GARDEN-03`
- `VV-SMOKE-04`
- `VV-GOLDEN-05`
- `VV-PURPLE-06`

Product data lives in `lib/products.js`.

## Supabase Orders

The order API writes to a Supabase `orders` table using the service role key.

Suggested schema:
```sql
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  phone text,
  fulfillment text not null,
  address1 text,
  address2 text,
  city text,
  state text,
  postal_code text,
  note text,
  items jsonb not null,
  subtotal numeric not null,
  preorder boolean not null default false
);
```

API endpoint: `app/api/order/route.js`

## Customize

- Update copy and sections in `app/page.jsx`.
- Adjust styling in `app/globals.css`.
- Add or edit jars in `lib/products.js`.
