# Repository Script Guidance

These are operator/developer utilities, not request-path application code.

- Keep scripts non-interactive by default, with explicit arguments and actionable
  failures. Document any new command in `package.json` and `README.md`.
- Default reporting to aggregate, sanitized output. Never print service-role keys,
  raw customer rows, email addresses, street addresses, or full provider responses.
- A script that mutates Supabase or another service must require an explicit mode or
  confirmation flag, validate configuration before work, report counts, and be safe
  to retry. Provide a dry-run path when the operation can affect many records.
- Resolve repository paths from the script location, not the caller's current
  directory. Use Node built-ins and existing dependencies before adding a package.
- Keep `repo-security-checks.mjs` conservative: changes to its scan rules or
  allowlist require focused negative and positive verification.

Run the script with non-production/test inputs when possible, then run
`npm run lint` and `npm run security:repo`.

