create table if not exists checkout_shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  payment_session_id text unique,
  status text not null default 'quoted'
    check (status in ('quoted', 'label_purchased', 'cancelled')),
  provider text not null default 'easypost',
  quote_json jsonb not null check (jsonb_typeof(quote_json) = 'object'),
  postage_cents integer not null check (postage_cents >= 0),
  packaging_cents integer not null check (packaging_cents >= 0),
  unrounded_cents integer not null check (unrounded_cents >= 0),
  rounding_cents integer not null check (rounding_cents >= 0),
  charged_shipping_cents integer not null check (charged_shipping_cents >= 0),
  check (unrounded_cents = postage_cents + packaging_cents),
  check (charged_shipping_cents = unrounded_cents + rounding_cents),
  check (rounding_cents between 0 and 99),
  check (charged_shipping_cents = 0 or mod(charged_shipping_cents, 100) = 0),
  currency text not null default 'USD',
  delivery_days integer check (delivery_days is null or delivery_days >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkout_shipping_quotes_status_created_idx
  on checkout_shipping_quotes (status, created_at desc);

alter table checkout_shipping_quotes enable row level security;

revoke all on checkout_shipping_quotes from public, anon, authenticated;
