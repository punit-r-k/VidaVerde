# Vida Verde Storefront

Premium sourkrout and microgreen nourishment, built with Next.js + Supabase + Stripe.

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

## Inventory Sync (Google Sheets)

Inventory is stored in Supabase and synced to the `Inventory` sheet via Apps Script.
Column C is a restock delta; it is cleared after a successful sync to prevent double-counting.

Apps Script file: `apps-script/inventory-sync.gs`

Script properties required:
- `API_BASE_URL` (example: `https://your-site-url`)
- `ADMIN_RESTOCK_SECRET` (matches your `.env.local`)

Sheet columns:
- Column A: SKU (`VV1` ... `VV6`)
- Column B: Product (name or slug, optional)
- Column C: Stock input (restock delta)
- Column D: Stock Status (on_hand)
- Column E: Status (In Stock / Out of Stock)
- Column F: # of Preorders (editable; syncs to backend `preorders_remaining`)
- Column G: Expected restock date
- Column H: Total Sales

Spreadsheet toggle for stock visibility:
- The Apps Script creates a `Settings` sheet.
- Use `Settings!B2` (`Show stock on website`) checkbox to show/hide stock pills
  such as `Only 5 left` and `Sold Out` on the storefront.

## Supabase Schema

Schema + seed data live in `supabase/schema.sql`.
It defines tables for `products`, `inventory`, `orders`, `order_items`, and `preorder_queue`.
RPC functions:
- `record_paid_order` (Stripe webhook)
- `apply_restock` (restock delta)
- `set_expected_restock_date`

## Stripe Payments

PaymentIntents are created in `app/api/order/route.js`.
The storefront renders Stripe Elements on your domain, so card details are collected by Stripe and never stored by this app.
Stripe webhooks are handled in `app/api/stripe/webhook/route.js`.
Configure your Stripe webhook endpoint to listen to `payment_intent.succeeded` (and optionally keep `checkout.session.*` only if you still use hosted checkout).

Required environment variables:
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SITE_URL`

## Customize

- Update copy in `app/page.jsx` and `app/about/page.jsx`.
- Adjust styling in `app/globals.css`.
- Edit product catalog in the Supabase `products` table.

## Tailwind Hybrid Mode

Tailwind is configured in hybrid mode so existing CSS continues to work while you
migrate section-by-section:

- Config: `tailwind.config.js` (`preflight` disabled to avoid global resets)
- PostCSS: `postcss.config.js`
- Layers loaded in: `app/globals.css`

Current migrated example:
- The shop allergen chip bar in `app/page.jsx` now uses Tailwind utility classes.
