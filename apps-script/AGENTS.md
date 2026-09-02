# Google Apps Script Guidance

`inventory-sync.gs` is a live operations console for inventory, prep, orders,
shipments, email lists, health, and scheduled customer-email jobs. Make narrow edits;
there is no local bundler or lint coverage for this file.

## Operational Contracts

- Keep sheet names, headers, row offsets, and column indexes centralized in `CONFIG`.
  Treat existing spreadsheet layouts as a public interface for operators.
- Simple `onEdit` cannot call `UrlFetchApp`; authenticated network work belongs in the
  installable `onInventoryEdit` trigger or an explicit menu/clock handler.
- Admin calls use freshly signed, short-lived HS256 bearer JWTs and the configured
  issuer, audience, subject, and roles. Never restore the retired shared-secret header.
- Clear restock input before posting as the existing flow does, prevent duplicate
  application, and refresh authoritative server state after mutations.
- Preorder counts are read-only projections. Do not let a sheet edit directly set
  backlog totals.
- Preserve batching and execution-time budgets. Cache sheet/range handles and use
  bulk `getValues`/`setValues` operations instead of per-cell network loops.
- New scheduled work needs an idempotent server endpoint and trigger reset logic so
  setup does not create duplicate triggers.
- Keep user-facing failures useful but free of tokens, headers, raw responses, and
  customer-sensitive data.

## Coordinated Changes

When a sheet/API contract changes, update the matching route schema, Apps Script
request/response handling, README sheet documentation, and relevant operations tests
together. Recheck the spreadsheet manually in a copy: menu creation, trigger setup,
headers, formulas/formatting, one successful action, and one recoverable failure.

