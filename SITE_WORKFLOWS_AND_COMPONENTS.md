# Vida Verde Workflows And Website Components

This file is a practical map of the most important customer flows, operations flows, and code owners in this repo.

## Customer-Facing Workflows

### 1. Homepage And Storytelling Flow
- Entry page: `app/page.jsx`
- Supporting sections: hero, reviews, wellness education, shop, market pickup, founder story, FAQ, and email CTA.
- Navigation is section-based rather than page-heavy, with `JumpNav` linking users directly to key anchors on the homepage.
- Supporting standalone pages:
  - `app/about/page.jsx`
  - `app/privacy-policy/page.jsx`

### 2. Product Discovery And Shopping
- Main component: `app/components/Storefront.jsx`
- Product catalog source: `lib/products.js`
- Inventory source: `lib/stock.js`
- Behavior:
  - Products are loaded server-side from Supabase, with fallback product data when Supabase is unavailable.
  - Inventory is loaded server-side, then polled client-side every 30 seconds through `GET /api/inventory`.
  - The storefront calculates in-stock units vs preorder units per SKU.
  - Stock badges are globally controlled by the `show_stock` site setting.

### 3. Checkout And Payment
- Main component: `app/components/Storefront.jsx`
- Request validation: `lib/checkoutSchema.js`
- Payment API: `app/api/order/route.js`
- Payment provider wrapper: `lib/stripe.js`
- Behavior:
  - The current UI is effectively pickup-first. Fulfillment is locked to market pickup in the visible form, even though backend structures still support shipping.
  - Customer details are validated before payment.
  - Stripe Elements collects card data in-browser.
  - `POST /api/order` creates a Stripe PaymentIntent and stores order context in Stripe metadata.
  - Successful payment is finalized later by the Stripe webhook, not by the browser alone.

### 4. Paid Order Recording And Fulfillment Side Effects
- Webhook: `app/api/stripe/webhook/route.js`
- Email composition: `lib/orderConfirmationEmail.js`
- Email transport: `lib/email.js`
- Behavior:
  - Stripe webhook verifies signatures and processes `payment_intent.succeeded`.
  - Paid orders are written into Supabase through the `record_paid_order` RPC.
  - Order items can contain a mix of ready reservation units and preorder units for the same customer.
  - Shipment sync side effects run after order creation.
  - Customer confirmation emails are sent after order persistence and guarded against duplicate sends.

### 5. Preorder Release And Ready Pickup Email Flow
- Restock side effect trigger: `app/api/admin/restock/route.js`
- Email composition and send flow: `lib/preorderReadyEmail.js`
- Release tracking: `supabase/schema.sql`
- Behavior:
  - Incoming stock is applied FIFO against `preorder_queue`.
  - Every quantity released by that restock is recorded in `preorder_release_events`.
  - Paid market-pickup orders with newly released preorder units can receive a ready-for-pickup email during the same restock flow.
  - The readiness email highlights the newly released items, reminds the customer of other already-ready items from the same order, and gives them one combined Vida Verde pickup list for market day.
  - The readiness email includes the active pickup details and tells the customer to text `(713) 478-1878` if they need another arrangement.

### 6. Market Pickup Scheduling And Policy
- Shared policy/time logic: `lib/pickupDetails.js`
- Policy UI: `app/components/MarketPickupPolicy.jsx`
- Behavior:
  - Market timing, same-day cutoff, pickup policy text, and displayed pickup date are all centralized.
  - The homepage market section and checkout flow both depend on this shared source.
  - The policy version is sent into order metadata so checkout records which pickup terms were accepted.

### 7. Pickup Reminder Email Flow
- Email composition and send flow: `lib/pickupReminderEmail.js`
- Admin trigger route: `app/api/admin/pickup-reminders/route.js`
- Scheduling hook: `apps-script/inventory-sync.gs`
- Behavior:
  - Friday reminder emails target paid market-pickup orders that are already scheduled for the coming Saturday.
  - The reminder email reuses the same branded banner image as the order confirmation email.
  - Standard ready pickup reservations are tracked with `orders.pickup_reminder_email_sent_at`.
  - Later preorder-release pickup reminders are tracked separately with `preorder_release_events.pickup_reminder_email_sent_at`.
  - The Apps Script can trigger the reminder flow manually or via a weekly Friday 12pm America/Chicago time trigger.

### 8. Email Capture
- Popup capture: `app/components/EmailListPopup.jsx`
- Inline CTA capture: `app/components/EmailSignupForm.jsx`
- API: `app/api/email-signups/route.js`
- Behavior:
  - The popup opens after a short delay unless previously dismissed in `localStorage`.
  - Both email capture surfaces post into the same API route.
  - Signups are stored in Supabase with source, client IP identifier, and user agent.

### 9. First-Party Analytics
- Client runtime: `app/components/AnalyticsRuntime.jsx`
- Shared event definitions and sanitization: `lib/analytics.js`
- API: `app/api/analytics/route.js`
- Behavior:
  - Tracks page views, section views, scroll milestones, product views, CTA clicks, email actions, checkout actions, testimonial interactions, and FAQ opens.
  - Uses batching, payload size limits, and metadata sanitization before writing to Supabase.
  - Analytics is same-origin constrained in production.

## Operations And Admin Workflows

### 1. Inventory Visibility And Storefront Availability
- Public inventory API: `app/api/inventory/route.js`
- Admin inventory API: `app/api/admin/inventory/route.js`
- Shared site setting: `lib/siteSettings.js`
- Behavior:
  - Public inventory returns SKU-level availability, preorder counts, units sold, restock dates, and the global `show_stock` flag.
  - Admin inventory API supports reading inventory plus updating restock dates and the stock-visibility toggle.
  - Preorder counts are derived from paid orders and queue state, not manually edited aggregates.

### 2. Restock Workflow From Google Sheets
- Apps Script entrypoint: `apps-script/inventory-sync.gs`
- Restock API: `app/api/admin/restock/route.js`
- Behavior:
  - The `Inventory` sheet is the operational control surface.
  - Editing stock input in column C posts a restock delta to the admin restock API.
  - Positive restocks are applied against outstanding preorder backlog before any extra stock is added back to `on_hand`.
  - The preorder queue is timestamped from the Stripe payment success time so restocks fulfill older paid preorders before newer ones.
  - The backend records preorder release events for each quantity that becomes newly available.
  - Market-pickup preorder-ready emails can be sent as part of the same restock request.
  - The script clears the input cell before posting to reduce duplicate submissions.
  - The preorder count column is effectively read-only in the sheet. Manual edits are reverted so queue integrity stays intact.
  - When preorder-ready emails are sent, the sheet shows a toast with the count and then refreshes the prep sheet.
  - Admin authentication is handled with short-lived JWTs generated by the Apps Script.

### 3. Weekly Prep Workflow
- Apps Script sync: `syncWeeklyPrep()` in `apps-script/inventory-sync.gs`
- Prep API: `app/api/admin/prep/route.js`
- Shared scheduling logic: `lib/pickupDetails.js`
- Behavior:
  - Pulls paid order items for the displayed prep window.
  - Counts ready reservation units from mixed orders immediately instead of hiding the whole order behind preorder status.
  - Adds preorder release events created in the same displayed prep window into this week's ship and market totals as fresh demand.
  - Merges newly ready market preorder items into Saturday pickup verification.
  - Builds a Google Sheet view for:
    - Saturday pickup verification
    - jars to make this week
    - preorder units that must be handled separately
  - The preorder section is sourced from live inventory preorder counts when the `Inventory` tab is available, so it reflects current outstanding backlog by SKU.

### 4. Orders And Shipments Reporting
- Orders API: `app/api/admin/orders/route.js`
- Shipments API: `app/api/admin/shipments/route.js`
- Apps Script sync functions:
  - `syncOrders()`
  - `syncShipments()`
- Behavior:
  - Orders view pulls paid orders and expands order items for operations review.
  - Shipments view can optionally refresh shipment state before reading.
  - Apps Script writes both datasets into dedicated tabs for non-technical operations use.

### 5. Email Signup Export
- Admin API: `app/api/admin/email-signups/route.js`
- Apps Script sync: `syncEmailSignups()` in `apps-script/inventory-sync.gs`
- Behavior:
  - Email signups can be exported into the `Email List` sheet for marketing follow-up.

### 6. Admin Authentication And Protection
- JWT verification: `lib/adminAuth.js`
- Route security wrapper: `lib/apiSecurity.js`
- Behavior:
  - Admin routes require bearer JWTs signed with `ADMIN_JWT_SECRET`.
  - Role checks distinguish inventory workflows from broader ops/admin workflows.
  - Rate limiting is applied across public and admin routes.

## Important Website Components

| Component / File | Responsibility |
| --- | --- |
| `app/page.jsx` | Main homepage composition and section ordering. |
| `app/components/Storefront.jsx` | Product cards, cart, checkout form, Stripe payment step, preorder logic, and inventory polling. |
| `app/components/EmailListPopup.jsx` | Delayed popup email capture modal with local dismissal persistence. |
| `app/components/EmailSignupForm.jsx` | Inline email signup form used in the homepage CTA section. |
| `app/components/JumpNav.jsx` | Mobile-friendly anchor navigation across homepage sections. |
| `app/components/MarketPickupPolicy.jsx` | Expandable pickup policy dropdown in the market section. |
| `app/components/TestimonialGrid.jsx` | Review carousel, modal detail view, swipe support, and analytics hooks. |
| `app/components/FaqAccordion.jsx` | Animated FAQ disclosure list. |
| `app/components/RevealOnScroll.jsx` | Shared motion wrapper used across multiple homepage sections. |
| `app/components/SiteFooter.jsx` | Brand footer, market schedule, contact email, social links, and privacy link. |
| `app/components/AnalyticsRuntime.jsx` | Global browser analytics collector mounted in layout. |
| `app/layout.jsx` | Global fonts, CSS, metadata, and analytics runtime mount. |

## Important Backend And Data Owners

| File | Responsibility |
| --- | --- |
| `lib/products.js` | Product catalog reads plus fallback catalog content. |
| `lib/stock.js` | Server-side inventory map generation for the storefront. |
| `lib/pickupDetails.js` | Market schedule, cutoff rules, policy copy, and week-window calculations. |
| `lib/preorderReadyEmail.js` | Preorder release email composition, grouping, and delivery for market pickup orders. |
| `app/api/order/route.js` | Checkout validation and Stripe PaymentIntent creation. |
| `app/api/stripe/webhook/route.js` | Source of truth for turning paid Stripe events into recorded orders. |
| `app/api/inventory/route.js` | Public inventory feed used by the storefront. |
| `app/api/email-signups/route.js` | Public email capture endpoint. |
| `app/api/analytics/route.js` | Analytics ingestion endpoint. |
| `app/api/admin/inventory/route.js` | Admin inventory read/update endpoint. |
| `app/api/admin/restock/route.js` | Admin restock delta endpoint plus preorder-ready email side effects. |
| `app/api/admin/prep/route.js` | Weekly production and pickup-prep dataset builder, including released preorder units. |
| `app/api/admin/orders/route.js` | Paid order reporting endpoint. |
| `app/api/admin/shipments/route.js` | Shipment reporting and refresh endpoint. |
| `app/api/admin/email-signups/route.js` | Admin export endpoint for email leads. |
| `apps-script/inventory-sync.gs` | Google Sheets integration for inventory, prep, orders, shipments, and email signups. |
| `supabase/schema.sql` | Core schema, RPCs, and data model for products, inventory, orders, preorder release events, shipments, and analytics. |

## Operational Notes

- The storefront is not just a brochure site. It is the live commerce surface and depends on Supabase, Stripe, analytics, and the inventory API.
- The Stripe webhook is the critical persistence point for paid orders. If it fails, payment may succeed in Stripe without operations data being written into Supabase.
- Google Sheets is a real operations console here, not a passive export. Inventory, prep, orders, shipments, and email signups all flow through `apps-script/inventory-sync.gs`.
- Positive restocks can have customer-visible side effects. They may reduce preorder backlog, create preorder release events, update the prep sheet, and send ready-for-pickup emails for market orders.
- Market pickup timing is a cross-cutting dependency. Changes to pickup rules should start in `lib/pickupDetails.js` so the site, checkout, and prep workflows stay aligned.
- `show_stock` is a global setting. It affects whether the storefront shows stock scarcity indicators, but inventory still powers availability and preorder behavior even when badges are hidden.
