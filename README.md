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
The same Apps Script also syncs the weekly prep, orders, shipments, and email
signup tabs used by operations.
When a positive restock releases market-pickup preorder units, the backend can also
send preorder-ready pickup emails, refresh the prep sheet, and return a count that
the sheet shows as a toast.

Apps Script file: `apps-script/inventory-sync.gs`

Script properties required:
- `API_BASE_URL` (example: `https://your-site-url`)
- `ADMIN_JWT_SECRET` (matches your server-side JWT signing secret)

Optional script properties:
- `ADMIN_JWT_ISSUER` (defaults to `vidaverde-admin`)
- `ADMIN_JWT_AUDIENCE` (defaults to `vidaverde-admin-api`)
- `ADMIN_JWT_SUBJECT` (defaults to `vidaverde-inventory-sync`)
- `ADMIN_JWT_ROLES` (defaults to `ops_admin,inventory_admin`)

The Apps Script now signs a fresh short-lived bearer JWT for each admin API request.
For a staged rollout, the script still accepts a legacy `ADMIN_RESTOCK_SECRET` property
as a fallback source for the signing secret, but the backend no longer accepts
`x-admin-secret` header authentication.

Sheet columns:
- Column A: SKU (`VV1` ... `VV6`)
- Column B: Product (name or slug, optional)
- Column C: Stock input (restock delta)
- Column D: Stock Status (on_hand)
- Column E: Status (In Stock / Out of Stock)
- Column F: # of Preorders (read-only; derived from paid orders and the preorder queue)
- Column G: Expected restock date
- Column H: Total Sales

Additional sheet behavior:
- The `Prepare for this week` tab now includes preorder units released by restocks
  in the active prep window as fresh demand for the current batch.
- The prep, orders, and shipments tabs normalize phone numbers into readable sheet
  output such as `+1 (346) 387-2454`.
- Manual edits to the preorder count column are reverted. Preorder backlog is managed
  from actual paid orders so fulfillment stays first-come-first-served.

Spreadsheet toggle for stock visibility:
- The Apps Script creates a `Settings` sheet.
- Use `Settings!B2` (`Show stock on website`) checkbox to show/hide stock pills
  such as `Only 5 left` and `Sold Out` on the storefront.

Email signup sheet:
- A dedicated `Email List` sheet is created automatically during sync.
- Columns: `Signed Up At`, `Email`, `Source`

## Supabase Schema

Schema + seed data live in `supabase/schema.sql`.
It defines tables for `products`, `inventory`, `orders`, `order_items`,
`preorder_queue`, `preorder_release_events`, `shipments`, and analytics data.

Preorder-specific data model:
- `preorder_queue` stores the remaining preorder backlog by order and SKU.
- `preorder_release_events` stores each quantity released by incoming stock so prep
  generation and preorder-ready pickup emails can react to newly available units.
- New paid orders stamp `orders`, `order_items`, and `preorder_queue` with the Stripe
  payment success time so restocks can fulfill preorders in true order sequence.

RPC functions:
- `record_paid_order` (Stripe webhook)
- `apply_restock` (restock delta plus preorder release event creation)
- `set_expected_restock_date`
- `consume_api_rate_limit` (distributed API throttling)

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

Optional for customer order confirmation and preorder-ready pickup emails:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `ORDER_EMAIL_FROM`
- `ORDER_EMAIL_REPLY_TO`
- `ORDER_EMAIL_BCC`
- `ORDER_EMAIL_BANNER_URL`

The webhook sends the customer confirmation email after a paid order is recorded.
To avoid duplicate sends on normal webhook retries, the database now tracks
`orders.customer_confirmation_email_sent_at`. Apply the updated
`supabase/schema.sql` in Supabase before relying on this in production.
The default banner image is bundled at `public/email/order-confirmation-banner.png`.

Preorder-ready pickup emails are sent separately from `lib/preorderReadyEmail.js`
when a restock releases market-pickup preorder units. Those emails use the same
banner image as the order confirmation email, include the current pickup date
details, and tell customers to call or text `(713) 478-1878` if they cannot make
the market and need another arrangement.

Friday pickup reminder emails are sent from `lib/pickupReminderEmail.js` through
`POST /api/admin/pickup-reminders`. They reuse the same banner image as the order
confirmation email and rely on reminder markers stored in:
- `orders.pickup_reminder_email_sent_at`
- `preorder_release_events.pickup_reminder_email_sent_at`

The Google Apps Script includes `setupFridayReminderTrigger()` to schedule this
admin action for Fridays at 12pm America/Chicago.

## API Security

Admin APIs under `app/api/admin/*` now require `Authorization: Bearer <jwt>`.
Tokens are validated on every request and must:
- be signed with `ADMIN_JWT_SECRET` using `HS256`
- include the configured issuer and audience
- include `exp`, `iat`, and `sub` claims
- include role claims (`admin`, `ops_admin`, or `inventory_admin`) depending on the route

Role enforcement:
- `orders`, `shipments`, and `prep` require `admin` or `ops_admin`
- `inventory` and `restock` require `admin` or `inventory_admin`

## CORS

API CORS is enforced centrally in `proxy.js`.
Only origins listed in the environment are allowed:
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGINS_DEVELOPMENT`
- `CORS_ALLOWED_ORIGINS_STAGING`
- `CORS_ALLOWED_ORIGINS_PRODUCTION`

Additional CORS controls:
- `CORS_ALLOWED_HEADERS`
- `CORS_ALLOWED_METHODS`
- `CORS_ALLOW_CREDENTIALS`

Do not use `*` for authenticated admin routes.

## Rate Limiting

Rate limiting is enforced on every API route.
If Supabase is available and the updated `supabase/schema.sql` has been applied,
limits are stored in Postgres via `consume_api_rate_limit` so they continue to work
across multiple app instances. If that RPC is missing, the app falls back to an
in-memory limiter until the schema is deployed.

Environment override pattern:
- `RATE_LIMIT_<ROUTE_KEY>_WINDOW_MS`
- `RATE_LIMIT_<ROUTE_KEY>_IP_MAX`
- `RATE_LIMIT_<ROUTE_KEY>_USER_MAX`

Examples:
- `RATE_LIMIT_ORDER_CREATE_IP_MAX=6`
- `RATE_LIMIT_ANALYTICS_CREATE_IP_MAX=180`
- `RATE_LIMIT_ADMIN_ORDERS_GET_USER_MAX=90`
- `RATE_LIMIT_ADMIN_SHIPMENTS_GET_IP_MAX=120`

## Analytics Reporting

First-party analytics events are stored in Supabase through `POST /api/analytics`.
Run the local reporting script to generate a sanitized summary for Codex or manual review:

```bash
npm run analytics:report -- --range=7d
npm run analytics:report -- --range=30d --format=json
```

The report outputs aggregates, funnels, friction points, and recommended actions only.
It does not print service-role keys, raw event rows, or raw PII.

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
