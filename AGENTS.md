# Vida Verde AI Working Guide

This file is the repository entry point for coding agents. Read the nearest nested
`AGENTS.md` before changing files in that subtree; nested guidance adds to this file.

## Start Here

1. Inspect `git status --short` and preserve unrelated user changes.
2. Locate the smallest owning module and its closest existing test before editing.
3. Read only the domain reference that applies to the task:

| Task | Primary reference |
| --- | --- |
| Find a workflow or code owner | `SITE_WORKFLOWS_AND_COMPONENTS.md` |
| Pickup, prep, or shipping cutoff behavior | `TIMING_REFERENCE.md` |
| Customer email behavior | `AUTOMATED_EMAILS.md` |
| EasyPost, quotes, labels, or shipping costs | `EASYPOST_OPERATIONS.md` |
| Environment variables and local setup | `README.md`, `.env.example` |
| Security expectations | `SECURITY.md`, `tests/security/security.test.mjs` |
| Stripe changes | `.agents/skills/stripe-best-practices/SKILL.md` and the relevant reference it routes to |
| Stripe API or SDK upgrades | `.agents/skills/upgrade-stripe/SKILL.md` |

`SITE_WORKFLOWS_AND_COMPONENTS.md` is a navigation aid, not the final authority for
fast-moving shipping details. For shipping, prefer current code, focused tests, the
latest migrations, and `EASYPOST_OPERATIONS.md`. If sources disagree, determine the
implemented behavior and update stale documentation in the same change.

## Repository Map

```text
app/                 Next.js App Router pages, components, and route handlers
lib/                 Shared domain logic and external-service adapters
supabase/            Fresh-install schema plus ordered production migrations
tests/               Node test runner suites; security integration tests are nested
apps-script/         Google Sheets operations console and scheduled jobs
scripts/             Local reporting, backfill, sync, and security utilities
public/              Shipped images, icons, video, and email assets
proxy.js             CORS and request-framing checks for every API route
```

Do not inspect or edit generated/dependency trees such as `node_modules`, `.next`, or
`.next-dev` unless the task explicitly concerns their generated output.

## Cross-Layer Invariants

- Amounts are integer cents. Server-side product, tax, and shipping calculations are
  authoritative; never trust prices supplied by the browser.
- Card data stays inside Stripe's Payment Element. This application creates
  PaymentIntents and never stores raw payment credentials.
- Paid-order persistence, refunds, disputes, preorder allocation, email claims, and
  shipment state depend on idempotent database RPCs. Preserve transaction and retry
  behavior when changing them.
- Checkout may rate and cache shipping, but it must not purchase a label. Label
  purchase is an explicit authenticated operator release. Preserve quote-budget,
  cost-coverage, and no-hidden-subsidy rules in `EASYPOST_OPERATIONS.md`.
- Preorders are allocated FIFO from paid-order timestamps. Never make
  `preorders_remaining` a manually editable source of truth.
- Pickup timing is centralized in `lib/pickupDetails.js`; carrier timing is
  centralized in `lib/shippingPricing.js` and public shipping environment values.
  Preserve exact-boundary behavior and `America/Chicago` semantics.
- The site currently sends only order confirmations, preorder-ready updates, and
  Friday pickup reminders. Do not introduce a new customer email as a side effect of
  an unrelated change.
- Never commit, print, or copy `.env.local` values. Add names and safe placeholders to
  `.env.example`; production and test Stripe/EasyPost credentials must stay separate.

## Change Shape

- Put reusable business rules in `lib/`; keep route handlers focused on transport,
  authorization, validation, and orchestration.
- Extend an existing helper or schema before duplicating normalization, time, money,
  auth, rate-limit, or response logic.
- When behavior crosses code and database boundaries, update the application,
  `supabase/schema.sql`, a new ordered migration, tests, and the relevant runbook as
  one coherent change.
- Avoid drive-by formatting and broad rewrites, especially in the large storefront,
  webhook, schema, and Apps Script files.

## Verification

Use the narrowest useful check while iterating, then expand in proportion to risk.

```powershell
node --test tests/shippingPricing.test.mjs  # replace with the closest focused suite
npm run lint
npm test
npm run security:repo
npm run test:security
npm run build
```

- Documentation-only changes: run `npm run security:repo` because Markdown is scanned.
- Domain changes: run the focused test, then `npm test` if the rule is cross-cutting.
- API, auth, CORS, webhook, dependency, or configuration changes: run lint, full unit
  tests, repository security checks, and `test:security`.
- Page, runtime, dependency, or production-configuration changes: also run `npm run build`.
- If a check cannot run because credentials or services are unavailable, report the
  exact skipped command and reason; do not claim it passed.

Keep tests serial when using the full suite (`npm test` already sets concurrency to 1).
