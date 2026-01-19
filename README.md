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
- Column F: # of Preorders
- Column G: Expected restock date
- Column H: Total Sales

## Supabase Schema

Schema + seed data live in `supabase/schema.sql`.
It defines tables for `products`, `inventory`, `orders`, `order_items`, and `preorder_queue`.
RPC functions:
- `record_paid_order` (Stripe webhook)
- `apply_restock` (restock delta)
- `set_expected_restock_date`

## Stripe Checkout

Checkout sessions are created in `app/api/order/route.js`.
Stripe webhooks are handled in `app/api/stripe/webhook/route.js`.

Required environment variables:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SITE_URL`

## Customize

- Update copy in `app/page.jsx` and `app/about/page.jsx`.
- Adjust styling in `app/globals.css`.
- Edit product catalog in the Supabase `products` table.
