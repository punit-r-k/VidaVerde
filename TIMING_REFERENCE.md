# Vida Verde Timing Reference

This document describes the current timing rules used across pickup, prep, the supplier sheet, and confirmation emails.

## Canonical Timezone

- All timing logic uses `America/Chicago`.
- This is the authoritative timezone for:
  - pickup cutoff calculations
  - pickup date calculations
  - prep sheet collection windows
  - market-day rollovers

Source:
- `lib/pickupDetails.js`

## Farmers Market Schedule

- Market: Fulshear Farmers Market
- Pickup day: every Saturday
- Pickup window: `9:00am-1:00pm`
- Same-day cutoff: `8:00am Saturday`

Operational meaning:
- A customer can place an in-stock market-pickup order up to `7:59am` on Saturday and still qualify for pickup that same day.
- At `8:00am Saturday`, same-day eligibility closes.
- Orders placed at or after `8:00am Saturday` roll to the following Saturday pickup date.

Source:
- `lib/pickupDetails.js`

## Core Order Collection Window

The core market cycle runs on a fixed weekly window:

- Start: previous Saturday at `8:00am` Central
- End: current Saturday at `7:59am` Central

In system terms:
- `collection_start_at` is inclusive
- `collection_end_at` is exclusive
- The API filters prep orders using:
  - `created_at >= collection_start_at`
  - `created_at < collection_end_at`

That means the logical order window is:

- `Saturday 8:00am` through `next Saturday 7:59:59...am`

Practical examples:

### Example 1

- Order placed: Saturday `7:59am`
- Result: included in the current market week
- Pickup date: the current Saturday

### Example 2

- Order placed: Saturday `8:00am`
- Result: excluded from the current market week
- Pickup date: the following Saturday

### Example 3

- Order placed: Wednesday afternoon
- Result: included in the current active market week
- Pickup date: the upcoming Saturday

Source:
- `lib/pickupDetails.js`
- `app/api/admin/prep/route.js`

## Customer-Facing Pickup Date Logic

Customer-facing pickup timing rolls forward immediately at `8:00am Saturday`.

This affects:
- storefront pickup messaging
- displayed pickup date on the site
- market section pickup date
- market-pickup confirmation emails

Rule:

- Before `8:00am Saturday`: the active pickup date is the current Saturday
- At or after `8:00am Saturday`: the active pickup date becomes next Saturday

This is intentional because same-day pickup is no longer available once the cutoff has passed.

Source:
- `lib/pickupDetails.js`
- `app/page.jsx`
- `lib/orderConfirmationEmail.js`

## Prep Sheet Display Timing

The supplier prep sheet intentionally does **not** roll forward at `8:00am`.

It uses a delayed display rollover:

- Prep sheet roll time: Saturday `2:00pm` Central

Why:

- The market selling window is `9:00am-1:00pm`
- An extra hour is allowed for leeway
- This lets the sheet continue showing the jars being sold that day during market hours and shortly after

Operational behavior:

- From Saturday `8:00am` through Saturday `1:59pm`, the prep sheet still shows the just-finished market batch
- At Saturday `2:00pm`, the prep sheet advances to the next collection window

Important distinction:

- The underlying order-collection logic still begins at `8:00am Saturday`
- Only the **sheet display week** is delayed until `2:00pm`

So there are two simultaneous truths:

1. New customer orders placed after `8:00am Saturday` belong to next week's market cycle
2. The `Prepare for this week` sheet keeps displaying the current market batch until `2:00pm Saturday`

Source:
- `lib/pickupDetails.js`
- `app/api/admin/prep/route.js`
- `apps-script/inventory-sync.gs`

## Prep Sheet Metadata

The `Prepare for this week` sheet shows:

- `Orders Collected`
- `Saturday Pickup`

### Orders Collected

This displays the collection window for the batch currently shown on the prep sheet.

Format example:

- `Sat, Apr 4, 8:00am to Sat, Apr 11, 7:59am`

### Saturday Pickup

This displays the Saturday market date associated with that displayed prep batch.

Important detail:

- Because the prep sheet can remain on the current week until `2:00pm Saturday`, the displayed `Saturday Pickup` value also remains on the current Saturday until that time.
- Once the sheet rolls at `2:00pm`, both `Orders Collected` and `Saturday Pickup` advance together.

Source:
- `apps-script/inventory-sync.gs`
- `app/api/admin/prep/route.js`

## Prep Sheet Product Totals

The prep sheet groups paid orders in the currently displayed prep window into:

- `Ship This Week`
- `Market This Saturday`
- `Total To Prepare`
- `Pre-orders`

Meaning:

- `Ship This Week`: ready shipping units in the active prep window, including preorder
  units released by restocks during that displayed window
- `Market This Saturday`: ready market-pickup units in the active prep window,
  including preorder units released by restocks during that displayed window
- `Total To Prepare`: `shipping_qty + market_qty`
- `Pre-orders`: remaining preorder backlog shown in the sheet's separate preorder
  section, sourced from live inventory `preorders_remaining` when the `Inventory`
  tab is available

The prep API only counts:

- paid orders
- ready reservation units from orders whose creation timestamp falls within the active
  prep sheet's collection window
- preorder release events whose `created_at` timestamp falls within the active prep
  sheet's collection window

Source:
- `app/api/admin/prep/route.js`
- `apps-script/inventory-sync.gs`
- `supabase/schema.sql`

## Restock Release Timing

Incoming stock can reduce preorder backlog before the entire original preorder row is
fully complete.

When that happens:

- `apply_restock` allocates stock FIFO across `preorder_queue`
- each released quantity is written into `preorder_release_events` at the moment the
  stock is applied
- the prep API treats those released units like fresh demand for the currently
  displayed prep window
- released market-pickup items also join Saturday pickup verification immediately

Operational meaning:

- If stock is received during the currently displayed prep window, the newly released
  units join this week's prep totals right away.
- Any preorder quantity that has not been released yet stays in the separate
  `Pre-orders To Handle Separately` section.
- Because the prep sheet display rolls at `2:00pm` Saturday, a release created before
  that roll still belongs to the currently displayed batch, even though same-day
  customer ordering already closed at `8:00am`.

Source:
- `app/api/admin/prep/route.js`
- `apps-script/inventory-sync.gs`
- `supabase/schema.sql`

## Preorder Ready Email Timing

Preorder-ready pickup emails are driven by preorder release events, not by the moment
an entire preorder row reaches `fulfilled_at`.

Current behavior:

- positive restocks can trigger a ready-email check for the affected SKU
- unsent `preorder_release_events` for paid market orders are grouped by order
- the email uses the current pickup date details at send time
- the message tells customers to text `(713) 478-1878` if they cannot make
  the market and need another arrangement

Source:
- `app/api/admin/restock/route.js`
- `lib/preorderReadyEmail.js`
- `supabase/schema.sql`

## Confirmation Email Timing

For market-pickup orders, the confirmation email shows:

- market name
- address
- pickup window
- pickup date

The pickup date in the email is calculated using the order's actual success timing, not simply the later email send time.

Specifically:

- the Stripe webhook passes a `placedAt` timestamp into the confirmation email flow
- the email uses that timestamp when calling pickup-date logic

Why this matters:

- If payment succeeds before `8:00am Saturday`, the email should still show the current Saturday pickup date
- If payment succeeds at or after `8:00am Saturday`, the email should show the following Saturday pickup date
- This avoids drift if webhook processing is delayed

Source:
- `app/api/stripe/webhook/route.js`
- `lib/orderConfirmationEmail.js`

## Timing Summary Table

| Context | Roll Time | Behavior Before Roll | Behavior At/After Roll |
| --- | --- | --- | --- |
| Customer same-day pickup eligibility | Saturday `8:00am` | Same-day pickup still allowed for in-stock orders | Same-day pickup closes; next Saturday becomes active |
| Public pickup-date logic | Saturday `8:00am` | Current Saturday is shown | Next Saturday is shown |
| Prep sheet display | Saturday `2:00pm` | Current market batch stays visible | Sheet advances to next market batch |
| Prep order collection window | Saturday `8:00am` to next Saturday `7:59am` | Orders belong to current batch | New batch begins exactly at `8:00am` |

## Saturday Boundary Examples

### Saturday `7:59am`

- Customer can still reserve same-day pickup
- Public pickup date shows current Saturday
- Prep sheet shows current Saturday batch
- Order belongs to the current prep window

### Saturday `8:00am`

- Same-day pickup closes
- Public pickup date switches to next Saturday
- Prep sheet still shows the current Saturday batch
- New orders now belong to the next prep window

### Saturday `1:59pm`

- Public pickup date is already on next Saturday
- Prep sheet still shows the current Saturday batch

### Saturday `2:00pm`

- Prep sheet advances to the next batch
- `Orders Collected` and `Pickup Date` on the sheet update together

## Source Files

- `lib/pickupDetails.js`
- `app/api/admin/prep/route.js`
- `apps-script/inventory-sync.gs`
- `app/page.jsx`
- `lib/orderConfirmationEmail.js`
- `app/api/stripe/webhook/route.js`
