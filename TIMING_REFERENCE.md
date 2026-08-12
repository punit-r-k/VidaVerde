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

## Carrier Shipping Schedule

Carrier shipping is separate from farmers-market pickup. Its single source of
truth is the public deployment configuration:

- `NEXT_PUBLIC_SHIPPING_DAYS=Saturday`
- `NEXT_PUBLIC_SHIPPING_CUTOFF_TIME=07:00`
- `NEXT_PUBLIC_SHIPPING_TIME_ZONE=America/Chicago`

Operational meaning with the current values:

- Saturday is the estimated carrier-handoff day.
- Only an eligible in-stock order completed strictly before `7:00am` Central on
  Saturday qualifies for an estimated handoff that Saturday.
- An order completed at exactly `7:00am`, or any time afterward, moves to the
  next configured shipping cycle.
- Preorder shipping orders use the first configured shipping cycle after all
  required items are estimated to be ready.
- Standard and expedited delivery calculations start from the estimated
  carrier-handoff date, not from the order date.
- Additional weekly handoff days can be added later as a comma-separated list,
  such as `Wednesday,Saturday`, without changing endpoint-specific logic.

Source:
- `lib/shippingPricing.js`
- `.env.example`

## Farmers Market Schedule

- Market: Fulshear Farmers Market
- Pickup day: every Saturday
- Pickup window: `9:00am-1:00pm`
- Pickup cutoff: `12:00pm Friday`

Operational meaning:
- A customer can place an in-stock market-pickup order up to `11:59am` on Friday and still qualify for pickup the next day, if stock is available.
- At `12:00pm Friday`, eligibility for that Saturday's pickup closes.
- Orders placed at or after `12:00pm Friday`, including orders placed on Saturday, roll to the following Saturday pickup date.

Source:
- `lib/pickupDetails.js`

## Core Order Collection Window

The core market cycle runs on a fixed weekly window:

- Start: previous Friday at `12:00pm` Central
- End: current Friday at `11:59am` Central

In system terms:
- `collection_start_at` is inclusive
- `collection_end_at` is exclusive
- The API filters prep orders using:
  - `created_at >= collection_start_at`
  - `created_at < collection_end_at`

That means the logical order window is:

- `Friday 12:00pm` through `next Friday 11:59:59...am`

Practical examples:

### Example 1

- Order placed: Friday `11:59am`
- Result: included in the current market week
- Pickup date: the next day, Saturday

### Example 2

- Order placed: Friday `12:00pm`
- Result: excluded from the current market week
- Pickup date: the following Saturday

### Example 3

- Order placed: Wednesday afternoon
- Result: included in the current active market week
- Pickup date: the upcoming Saturday

### Example 4

- Order placed: Saturday afternoon
- Result: included in the next market week
- Pickup date: the following Saturday

Source:
- `lib/pickupDetails.js`
- `app/api/admin/prep/route.js`

## Customer-Facing Pickup Date Logic

Customer-facing pickup timing rolls forward immediately at `12:00pm Friday`.

This affects:
- storefront pickup messaging
- displayed pickup date on the site
- market section pickup date
- market-pickup confirmation emails

Rule:

- Before `12:00pm Friday`: the active pickup date is the upcoming Saturday
- At or after `12:00pm Friday`: the active pickup date becomes the following Saturday

This is intentional because pickup for the upcoming Saturday is no longer available once the cutoff has passed.

Source:
- `lib/pickupDetails.js`
- `app/page.jsx`
- `lib/orderConfirmationEmail.js`

## Prep Sheet Display Timing

The supplier prep sheet intentionally does **not** roll forward at the Friday noon customer cutoff.

It uses a delayed display rollover:

- Prep sheet roll time: Saturday `2:00pm` Central

Why:

- The market selling window is `9:00am-1:00pm`
- An extra hour is allowed for leeway
- This lets the sheet continue showing the jars being sold that day during market hours and shortly after

Operational behavior:

- From Friday `12:00pm` through Saturday `1:59pm`, the prep sheet still shows the just-finished market batch
- At Saturday `2:00pm`, the prep sheet advances to the next collection window

Important distinction:

- The underlying order-collection logic still begins at `12:00pm Friday`
- Only the **sheet display week** is delayed until `2:00pm`

So there are two simultaneous truths:

1. New customer orders placed at or after `12:00pm Friday` belong to next week's market cycle
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

- `Fri, Apr 3, 12:00pm to Fri, Apr 10, 11:59am`

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
  that roll still belongs to the currently displayed batch, even though customer
  ordering for that Saturday already closed at `12:00pm Friday`.

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

- If payment succeeds before `12:00pm Friday`, the email should still show the upcoming Saturday pickup date
- If payment succeeds at or after `12:00pm Friday`, the email should show the following Saturday pickup date
- This avoids drift if webhook processing is delayed

Source:
- `app/api/stripe/webhook/route.js`
- `lib/orderConfirmationEmail.js`

## Timing Summary Table

| Context | Roll Time | Behavior Before Roll | Behavior At/After Roll |
| --- | --- | --- | --- |
| Customer pickup eligibility | Friday `12:00pm` | Upcoming Saturday pickup still allowed for in-stock orders | Upcoming Saturday pickup closes; following Saturday becomes active |
| Public pickup-date logic | Friday `12:00pm` | Upcoming Saturday is shown | Following Saturday is shown |
| Prep sheet display | Saturday `2:00pm` | Current market batch stays visible | Sheet advances to next market batch |
| Prep order collection window | Friday `12:00pm` to next Friday `11:59am` | Orders belong to current batch | New batch begins exactly at `12:00pm Friday` |

## Cutoff Boundary Examples

### Friday `11:59am`

- Customer can still reserve pickup for the next day
- Public pickup date shows the upcoming Saturday
- Prep sheet shows current Saturday batch
- Order belongs to the current prep window

### Friday `12:00pm`

- Current Saturday pickup closes for new orders
- Public pickup date switches to the following Saturday
- Prep sheet still shows the current Saturday batch until Saturday `2:00pm`
- New orders now belong to the next prep window

### Saturday `12:00pm`

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
