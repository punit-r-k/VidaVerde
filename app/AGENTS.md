# Next.js App Guidance

Applies to pages, layouts, metadata routes, and everything below `app/`. API handlers
also follow `app/api/AGENTS.md`; interactive components also follow
`app/components/AGENTS.md`.

## Boundaries

- Use App Router conventions. Pages and layouts are Server Components unless browser
  state, effects, DOM APIs, or event handlers require a client boundary.
- Keep `"use client"` at the smallest practical component boundary. Server-only
  modules such as Supabase admin, Stripe secrets, SMTP, and EasyPost must never enter a
  client import graph.
- Use the `@/` alias for cross-tree imports and relative imports for nearby app files,
  matching surrounding code.
- Runtime-backed storefront pages intentionally use Node.js and dynamic rendering;
  do not add caching without checking inventory and timing freshness.

## Pages, Metadata, and Styling

- Reuse `lib/siteMetadata.js` for canonical URLs, organization data, contact details,
  and page metadata. Keep visible copy and JSON-LD facts synchronized.
- Reuse `lib/pickupDetails.js` and `lib/shippingPricing.js` for schedule or policy copy;
  do not embed a second version in JSX.
- Global styling lives in `app/globals.css` and follows the existing BEM-like class
  naming. Search for the component's current class block before adding selectors.
- Use `next/image` with meaningful alt text and explicit dimensions for content
  images. Decorative imagery should not create noisy accessible names.
- Preserve the skip link, semantic landmarks, focus behavior, keyboard paths,
  reduced-motion behavior, and mobile layouts when changing structure.

## Verification

Run `npm run lint`. Add `npm run build` for page/layout/metadata changes, and run
`node --test tests/seoMetadata.test.mjs` when metadata, robots, sitemap, JSON-LD, or
`llms.txt` behavior changes.

