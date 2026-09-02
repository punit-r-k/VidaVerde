# Supabase Schema and Migration Guidance

## Two Database Paths

- `schema.sql` is the complete current snapshot for a fresh database.
- `migrations/*.sql` are incremental production changes and run in filename order.
- Never apply the full snapshot after the migrations to the same database.

Every new production database change needs both a new timestamped migration and the
equivalent final state in `schema.sql`. Do not rewrite an already-deployed migration;
add a later corrective migration.

## Database Invariants

- Use transactions for changes that must deploy atomically.
- Preserve checks for non-negative integer-cent amounts and totals matching their
  components.
- Order/payment state, FIFO preorder allocation, quote budget reservation, email
  claiming, and shipment release are concurrency-sensitive. Keep the decision and
  mutation together in SQL/RPC when partial application would be unsafe.
- RPCs called through `supabaseAdmin` should explicitly set a safe `search_path`, have
  deliberate execute grants/revokes, and avoid accidental access by `anon` or
  `authenticated`.
- Prefer additive, backfilled, then constrained changes for populated tables. Make
  retry behavior explicit and keep backfills idempotent where practical.
- Test orders must remain excluded from production sales and payout totals.

## Migration Workflow

1. Choose a filename later than every existing migration using
   `YYYYMMDDHHMMSS_description.sql`.
2. Write the incremental change without assuming a fresh database.
3. Update `schema.sql` to represent the resulting fresh-install state.
4. Update every application caller and operational document affected by the contract.
5. Add or extend database-focused tests in `tests/`.

At minimum run `node --test tests/databaseHardening.test.mjs` and any focused order,
email, payment, or shipping suite. Run `npm test` for RPC contract or state-machine
changes.

