create table if not exists shipment_quotes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  provider text not null default 'easypost',
  plan_key text not null,
  postage_cents integer not null check (postage_cents >= 0),
  box_cost_cents integer not null check (box_cost_cents >= 0),
  total_cost_cents integer not null check (total_cost_cents >= 0),
  currency text not null default 'USD',
  quote_json jsonb not null check (jsonb_typeof(quote_json) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists shipment_parcels (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  quote_id uuid references shipment_quotes(id) on delete set null,
  parcel_index integer not null check (parcel_index > 0),
  product_family text not null check (product_family in ('sauerkraut', 'hot_sauce')),
  package_code text not null,
  supplier text,
  item_quantity integer not null check (item_quantity > 0),
  length numeric(8,3) not null,
  width numeric(8,3) not null,
  height numeric(8,3) not null,
  weight_oz numeric(9,3) not null,
  box_cost_cents integer not null default 0,
  postage_cents integer not null default 0,
  easypost_shipment_id text not null unique,
  easypost_rate_id text not null,
  carrier text,
  service text,
  tracking_number text,
  label_url text,
  label_pdf_url text,
  status text not null default 'label_purchased'
    check (status in ('label_purchased', 'shipped', 'delivered', 'cancelled')),
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipment_id, parcel_index)
);

create index if not exists shipment_quotes_shipment_created_idx on shipment_quotes (shipment_id, created_at desc);
create index if not exists shipment_parcels_shipment_idx on shipment_parcels (shipment_id, parcel_index);
create index if not exists shipment_parcels_tracking_idx on shipment_parcels (tracking_number);

alter table shipment_quotes enable row level security;
alter table shipment_parcels enable row level security;
