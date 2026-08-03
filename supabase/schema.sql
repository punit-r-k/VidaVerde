-- Vida Verde Supabase schema
-- Run in the Supabase SQL editor to recreate tables, functions, and seed data.

begin;

create extension if not exists "pgcrypto";

revoke create on schema public from public, anon, authenticated;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  slug text not null unique,
  name text not null,
  profile text not null,
  description text not null,
  specs text[] not null default '{}',
  image_url text not null,
  price_cents integer not null check (price_cents >= 0),
  product_type text not null default 'sauerkraut'
    check (product_type in ('sauerkraut', 'hot_sauce')),
  size_oz integer not null check (size_oz > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory (
  sku text primary key references products(sku) on update cascade on delete restrict,
  on_hand integer not null default 0 check (on_hand >= 0),
  preorders_remaining integer not null default 0 check (preorders_remaining >= 0),
  units_sold integer not null default 0 check (units_sold >= 0),
  expected_restock_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_settings (
  id boolean primary key default true check (id),
  show_stock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  payment_session_id text not null unique,
  payment_reference text,
  payment_provider text not null default 'stripe',
  status text not null default 'paid'
    check (status in ('paid', 'pending', 'cancelled', 'refunded', 'disputed', 'fulfilled')),
  fulfillment text not null check (fulfillment in ('ship', 'market')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  address1 text,
  address2 text,
  city text,
  state text,
  postal_code text,
  note text,
  currency text not null default 'usd' check (lower(currency) = 'usd'),
  amount_subtotal integer not null default 0 check (amount_subtotal >= 0),
  amount_tax integer not null default 0 check (amount_tax >= 0),
  amount_shipping integer not null default 0 check (amount_shipping >= 0),
  amount_total integer not null default 0 check (amount_total >= 0),
  stripe_state_effective_at timestamptz,
  stripe_state_observed_at timestamptz,
  stripe_state_retire_work boolean not null default false,
  stripe_fulfillment_retired_at timestamptz,
  shipping_tier text,
  shipping_option text,
  shipping_option_label text,
  shipping_estimate text,
  sauerkraut_count integer not null default 0 check (sauerkraut_count >= 0),
  hot_sauce_count integer not null default 0 check (hot_sauce_count >= 0),
  is_test_order boolean not null default false,
  customer_confirmation_email_sent_at timestamptz,
  customer_confirmation_email_claimed_at timestamptz,
  customer_confirmation_email_claim_token uuid,
  pickup_reminder_email_sent_at timestamptz,
  pickup_date date,
  constraint orders_total_matches_components
    check (amount_total = amount_subtotal + amount_tax + amount_shipping),
  constraint orders_market_has_no_shipping_charge
    check (fulfillment <> 'market' or amount_shipping = 0),
  created_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  payment_session_id text not null unique,
  payment_reference text,
  status text not null default 'pending_label'
    check (status in ('pending_label', 'purchasing_label', 'label_purchased', 'shipped', 'delivered', 'cancelled')),
  label_provider text,
  label_url text,
  tracking_number text,
  carrier text,
  service text,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  address1 text not null,
  address2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'US',
  items_summary text not null default '',
  items_json jsonb not null default '[]'::jsonb,
  item_count integer not null default 0 check (item_count >= 0),
  amount_total integer not null default 0 check (amount_total >= 0),
  currency text not null default 'USD',
  shipping_tier text,
  shipping_option text,
  shipping_option_label text,
  shipping_estimate text,
  sauerkraut_count integer not null default 0 check (sauerkraut_count >= 0),
  hot_sauce_count integer not null default 0 check (hot_sauce_count >= 0),
  notes text,
  label_purchased_at timestamptz,
  label_purchase_started_at timestamptz,
  label_purchase_error text,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  service_level text check (service_level is null or service_level in ('normal', 'expedited')),
  expected_arrival_date date,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipment_parcels (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  quote_id uuid references shipment_quotes(id) on delete set null,
  parcel_index integer not null check (parcel_index > 0),
  product_family text not null check (product_family in ('sauerkraut', 'hot_sauce')),
  package_code text not null, supplier text,
  item_quantity integer not null check (item_quantity > 0),
  length numeric(8,3) not null, width numeric(8,3) not null, height numeric(8,3) not null,
  weight_oz numeric(9,3) not null, box_cost_cents integer not null default 0,
  postage_cents integer not null default 0,
  easypost_shipment_id text not null unique, easypost_rate_id text not null,
  carrier text, service text, tracking_number text, label_url text, label_pdf_url text,
  status text not null default 'label_purchased'
    check (status in ('label_purchased', 'shipped', 'delivered', 'cancelled')),
  purchased_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (shipment_id, parcel_index)
);

create table if not exists email_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'website',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists do_not_market (
  email text primary key,
  reason text not null default 'manual',
  source_message_id text,
  unsubscribed_at timestamptz not null default now(),
  check (email = lower(trim(email)))
);

create or replace function unsubscribe_email_addresses(
  p_emails text[],
  p_reason text default 'manual',
  p_source_message_id text default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_emails text[];
  v_removed integer := 0;
begin
  select array_agg(distinct lower(trim(value)))
    into v_emails
  from unnest(coalesce(p_emails, array[]::text[])) as value
  where trim(value) <> '';

  if coalesce(array_length(v_emails, 1), 0) = 0 then
    return 0;
  end if;

  insert into do_not_market (email, reason, source_message_id, unsubscribed_at)
  select value, coalesce(nullif(trim(p_reason), ''), 'manual'),
    nullif(trim(p_source_message_id), ''), now()
  from unnest(v_emails) as value
  on conflict (email) do update
  set reason = excluded.reason,
      source_message_id = coalesce(excluded.source_message_id, do_not_market.source_message_id),
      unsubscribed_at = excluded.unsubscribed_at;

  delete from email_signups where lower(trim(email)) = any(v_emails);
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create or replace function subscribe_email_address(
  p_email text,
  p_source text default 'website',
  p_ip_address text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  delete from email_signups where lower(trim(email)) = v_email;
  delete from do_not_market where email = v_email;
  insert into email_signups (email, source, ip_address, user_agent)
  values (v_email, coalesce(nullif(trim(p_source), ''), 'website'), p_ip_address, p_user_agent)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function apply_email_list_changes(
  p_remove_emails text[],
  p_restore_emails text[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_remove text[];
  v_restore text[];
  v_removed integer := 0;
  v_restored integer := 0;
begin
  select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into v_remove
  from unnest(coalesce(p_remove_emails, array[]::text[])) as value
  where trim(value) <> '';
  select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into v_restore
  from unnest(coalesce(p_restore_emails, array[]::text[])) as value
  where trim(value) <> '';
  if v_remove && v_restore then
    raise exception 'An email address cannot be removed and restored in the same change.';
  end if;

  insert into do_not_market (email, reason, source_message_id, unsubscribed_at)
  select value, 'manual_sheet', null, now() from unnest(v_remove) as value
  on conflict (email) do update
  set reason = excluded.reason, unsubscribed_at = excluded.unsubscribed_at;
  delete from email_signups where lower(trim(email)) = any(v_remove);
  get diagnostics v_removed = row_count;

  select coalesce(array_agg(d.email), array[]::text[])
    into v_restore from do_not_market d where d.email = any(v_restore);
  delete from email_signups where lower(trim(email)) = any(v_restore);
  delete from do_not_market where email = any(v_restore);
  insert into email_signups (email, source)
  select value, 'admin_restore' from unnest(v_restore) as value;
  get diagnostics v_restored = row_count;

  return jsonb_build_object('removed_count', v_removed, 'restored_count', v_restored);
end;
$$;

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  occurred_at timestamptz not null default now(),
  visitor_id text not null,
  session_id text not null,
  page_view_id text not null,
  page_path text not null,
  page_search text,
  referrer_path text,
  section_id text,
  element_id text,
  product_sku text,
  checkout_step text check (checkout_step in ('details', 'payment')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists email_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('order_confirmation')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  order_id uuid references orders(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  processed_at timestamptz,
  message_id text not null,
  last_error_code text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders
  add column if not exists customer_confirmation_email_claim_token uuid;

alter table email_jobs
  add column if not exists claim_token uuid,
  add column if not exists message_id text,
  add column if not exists last_error_code text;

update email_jobs
set message_id = format(
  '<vida-verde-order-%s-job-%s@notifications.vida-verde>',
  coalesce(order_id::text, 'unknown'),
  id::text
)
where nullif(trim(coalesce(message_id, '')), '') is null;

alter table email_jobs alter column message_id set not null;
alter table email_jobs drop constraint if exists email_jobs_message_id_safe;
alter table email_jobs add constraint email_jobs_message_id_safe
  check (
    length(message_id) between 3 and 320
    and message_id !~ E'[\\r\\n]'
  );

update email_jobs
set claim_token = coalesce(claim_token, gen_random_uuid()),
    claimed_at = coalesce(claimed_at, updated_at, created_at, now())
where status in ('pending', 'processing');

update email_jobs
set claim_token = null,
    claimed_at = null
where status in ('sent', 'failed');

with active_job as (
  select distinct on (ej.order_id)
    ej.order_id,
    ej.claim_token,
    ej.claimed_at
  from email_jobs ej
  where ej.order_id is not null
    and ej.status in ('pending', 'processing')
  order by ej.order_id, ej.created_at, ej.id
)
update orders o
set customer_confirmation_email_claim_token = aj.claim_token,
    customer_confirmation_email_claimed_at = aj.claimed_at
from active_job aj
where o.id = aj.order_id
  and o.customer_confirmation_email_sent_at is null;

update orders
set customer_confirmation_email_claim_token = gen_random_uuid()
where customer_confirmation_email_sent_at is null
  and customer_confirmation_email_claimed_at is not null
  and customer_confirmation_email_claim_token is null;

update orders
set customer_confirmation_email_claim_token = null,
    customer_confirmation_email_claimed_at = null
where customer_confirmation_email_sent_at is not null;

create index if not exists email_signups_email_idx on email_signups (email);
create index if not exists email_signups_created_at_idx on email_signups (created_at desc);
create index if not exists do_not_market_unsubscribed_at_idx on do_not_market (unsubscribed_at desc);
create index if not exists analytics_events_created_at_idx on analytics_events (created_at desc);
create index if not exists analytics_events_event_created_at_idx on analytics_events (event_name, created_at desc);
create index if not exists analytics_events_page_created_at_idx on analytics_events (page_path, created_at desc);
create index if not exists analytics_events_section_created_at_idx on analytics_events (section_id, created_at desc);
create index if not exists analytics_events_product_created_at_idx on analytics_events (product_sku, created_at desc);
create index if not exists analytics_events_session_created_at_idx on analytics_events (session_id, created_at desc);
create index if not exists orders_test_order_created_at_idx on orders (created_at desc) where is_test_order;

create index if not exists shipments_status_created_at_idx on shipments (status, created_at desc);
create index if not exists shipments_created_at_idx on shipments (created_at desc);
create index if not exists shipment_quotes_shipment_created_idx on shipment_quotes (shipment_id, created_at desc);
create index if not exists checkout_shipping_quotes_status_created_idx on checkout_shipping_quotes (status, created_at desc);
create index if not exists shipment_parcels_shipment_idx on shipment_parcels (shipment_id, parcel_index);
create index if not exists shipment_parcels_tracking_idx on shipment_parcels (tracking_number);
create index if not exists orders_status_created_fulfillment_idx
  on orders (status, created_at desc, fulfillment);
create index if not exists email_jobs_status_available_idx
  on email_jobs (status, available_at, created_at);
create index if not exists email_jobs_order_type_idx
  on email_jobs (order_id, type);
drop index if exists email_jobs_order_confirmation_active_idx;
create unique index email_jobs_order_confirmation_active_idx
  on email_jobs (order_id, type)
  where type = 'order_confirmation'
    and status in ('pending', 'processing');
create unique index if not exists email_jobs_message_id_uidx
  on email_jobs (message_id);
create index if not exists email_jobs_processing_claim_idx
  on email_jobs (claimed_at, created_at, id)
  where status = 'processing';
create index if not exists orders_confirmation_email_claim_idx
  on orders (customer_confirmation_email_claimed_at, id)
  where customer_confirmation_email_sent_at is null
    and customer_confirmation_email_claimed_at is not null;

alter table products
  add column if not exists product_type text not null default 'sauerkraut';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_product_type_check'
  ) then
    alter table products
      add constraint products_product_type_check
      check (product_type in ('sauerkraut', 'hot_sauce'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'stripe_session_id'
  ) then
    alter table orders rename column stripe_session_id to payment_session_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'stripe_payment_intent'
  ) then
    alter table orders rename column stripe_payment_intent to payment_reference;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'payment_provider'
  ) then
    alter table orders add column payment_provider text not null default 'stripe';
  else
    alter table orders alter column payment_provider set default 'stripe';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'customer_confirmation_email_sent_at'
  ) then
    alter table orders add column customer_confirmation_email_sent_at timestamptz;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'customer_confirmation_email_claimed_at'
  ) then
    alter table orders add column customer_confirmation_email_claimed_at timestamptz;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'pickup_reminder_email_sent_at'
  ) then
    alter table orders add column pickup_reminder_email_sent_at timestamptz;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'orders' and column_name = 'pickup_date'
  ) then
    alter table orders add column pickup_date date;
  end if;

  alter table orders add column if not exists shipping_tier text;
  alter table orders add column if not exists stripe_state_effective_at timestamptz;
  alter table orders add column if not exists stripe_state_observed_at timestamptz;
  alter table orders add column if not exists stripe_state_retire_work boolean not null default false;
  alter table orders add column if not exists stripe_fulfillment_retired_at timestamptz;
  alter table orders add column if not exists shipping_option text;
  alter table orders add column if not exists shipping_option_label text;
  alter table orders add column if not exists shipping_estimate text;
  alter table orders add column if not exists sauerkraut_count integer not null default 0 check (sauerkraut_count >= 0);
  alter table orders add column if not exists hot_sauce_count integer not null default 0 check (hot_sauce_count >= 0);

  alter table shipments add column if not exists shipping_tier text;
  alter table shipments add column if not exists shipping_option text;
  alter table shipments add column if not exists shipping_option_label text;
  alter table shipments add column if not exists shipping_estimate text;
  alter table shipments add column if not exists sauerkraut_count integer not null default 0 check (sauerkraut_count >= 0);
  alter table shipments add column if not exists hot_sauce_count integer not null default 0 check (hot_sauce_count >= 0);
end $$;

update orders
set stripe_state_effective_at = coalesce(
      stripe_state_effective_at,
      '-infinity'::timestamptz
    ),
    stripe_state_observed_at = coalesce(
      stripe_state_observed_at,
      '-infinity'::timestamptz
    )
where stripe_state_effective_at is null
   or stripe_state_observed_at is null;

update orders
set stripe_state_retire_work = true,
    stripe_fulfillment_retired_at = coalesce(
      stripe_fulfillment_retired_at,
      created_at
    )
where status in ('refunded', 'disputed')
  and stripe_state_effective_at = '-infinity'::timestamptz;

create or replace function guard_retired_stripe_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retired_at timestamptz;
begin
  if new.status not in ('pending_label', 'purchasing_label') then
    return new;
  end if;

  select o.stripe_fulfillment_retired_at
    into v_retired_at
    from orders o
    where o.id = new.order_id;

  if v_retired_at is not null then
    new.status := 'cancelled';
    new.label_purchase_started_at := null;
    new.label_purchase_error :=
      'Fulfillment is blocked because the payment state retired its inventory allocation; operator reconciliation is required.';
    new.updated_at := clock_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists shipments_guard_retired_stripe_fulfillment on shipments;
create trigger shipments_guard_retired_stripe_fulfillment
before insert or update of status, label_purchase_started_at on shipments
for each row execute function guard_retired_stripe_fulfillment();

revoke all on function guard_retired_stripe_fulfillment()
  from public, anon, authenticated;

create index if not exists orders_pickup_date_status_idx
  on orders (pickup_date, status)
  where pickup_date is not null;

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null references products(sku) on update cascade,
  quantity integer not null check (quantity > 0),
  price_cents integer not null check (price_cents >= 0),
  preorder_qty integer not null default 0
    check (preorder_qty >= 0 and preorder_qty <= quantity),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items (order_id);

create or replace function get_non_test_units_sold()
returns table (
  sku text,
  units_sold bigint
)
language sql
stable
set search_path = public
as $$
  select
    oi.sku,
    sum(oi.quantity)::bigint as units_sold
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.status = 'paid'
    and not coalesce(o.is_test_order, false)
  group by oi.sku
  order by oi.sku;
$$;

create table if not exists preorder_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null references products(sku) on update cascade,
  quantity integer not null check (quantity > 0),
  remaining integer not null check (remaining >= 0 and remaining <= quantity),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  ready_pickup_email_sent_at timestamptz
);

create index if not exists preorder_queue_sku_idx on preorder_queue (sku, created_at, id);

create table if not exists preorder_release_events (
  id uuid primary key default gen_random_uuid(),
  preorder_queue_id uuid not null references preorder_queue(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null references products(sku) on update cascade,
  quantity integer not null check (quantity > 0),
  ready_pickup_email_sent_at timestamptz,
  ready_pickup_email_claim_token uuid,
  ready_pickup_email_claimed_at timestamptz,
  pickup_reminder_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table preorder_release_events
  add column if not exists ready_pickup_email_claim_token uuid,
  add column if not exists ready_pickup_email_claimed_at timestamptz;

create index if not exists preorder_release_events_sku_created_at_idx
  on preorder_release_events (sku, created_at desc, id);
create index if not exists preorder_release_events_order_created_at_idx
  on preorder_release_events (order_id, created_at desc, id);
create index if not exists preorder_release_events_ready_email_unsent_idx
  on preorder_release_events (order_id, created_at, id)
  where ready_pickup_email_sent_at is null;
create index if not exists preorder_release_events_ready_email_claim_idx
  on preorder_release_events (ready_pickup_email_claimed_at, order_id, id)
  where ready_pickup_email_sent_at is null
    and ready_pickup_email_claim_token is not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'preorder_queue'
      and column_name = 'ready_pickup_email_sent_at'
  ) then
    alter table preorder_queue add column ready_pickup_email_sent_at timestamptz;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'preorder_release_events'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_name = 'preorder_release_events'
      and column_name = 'ready_pickup_email_sent_at'
  ) then
    alter table preorder_release_events add column ready_pickup_email_sent_at timestamptz;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'preorder_release_events'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_name = 'preorder_release_events'
      and column_name = 'pickup_reminder_email_sent_at'
  ) then
    alter table preorder_release_events add column pickup_reminder_email_sent_at timestamptz;
  end if;
end $$;

create index if not exists preorder_release_events_created_pickup_reminder_idx
  on preorder_release_events (created_at desc, pickup_reminder_email_sent_at);

create table if not exists restock_events (
  id uuid primary key default gen_random_uuid(),
  sku text not null references products(sku) on update cascade,
  restock_qty integer not null,
  created_at timestamptz not null default now()
);

create table if not exists api_rate_limits (
  bucket text primary key,
  scope text not null,
  window_started_at timestamptz not null,
  count integer not null default 0 check (count >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limits_expires_at_idx on api_rate_limits (expires_at);

alter table restock_events drop constraint if exists restock_events_restock_qty_check;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function consume_api_rate_limit(
  p_bucket text,
  p_scope text,
  p_window_seconds integer,
  p_max integer
) returns table (
  allowed boolean,
  count integer,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started timestamptz;
  v_reset_at timestamptz;
  v_count integer;
begin
  if coalesce(length(trim(p_bucket)), 0) = 0 then
    raise exception 'Rate limit bucket is required.';
  end if;

  if coalesce(length(trim(p_scope)), 0) = 0 then
    raise exception 'Rate limit scope is required.';
  end if;

  if p_window_seconds <= 0 then
    raise exception 'Rate limit window must be positive.';
  end if;

  if p_max <= 0 then
    raise exception 'Rate limit max must be positive.';
  end if;

  v_window_started := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_reset_at := v_window_started + make_interval(secs => p_window_seconds);

  insert into api_rate_limits as rl (
    bucket,
    scope,
    window_started_at,
    count,
    expires_at,
    updated_at
  ) values (
    p_bucket,
    p_scope,
    v_window_started,
    1,
    v_reset_at,
    v_now
  )
  on conflict (bucket) do update
    set scope = excluded.scope,
        window_started_at = excluded.window_started_at,
        count = case
          when rl.expires_at <= v_now or rl.window_started_at <> excluded.window_started_at then 1
          else rl.count + 1
        end,
        expires_at = excluded.expires_at,
        updated_at = v_now
  returning rl.count, rl.expires_at into v_count, v_reset_at;

  if random() < 0.01 then
    delete from api_rate_limits
    where expires_at < v_now - interval '1 day';
  end if;

  return query
  select
    v_count <= p_max,
    v_count,
    greatest(p_max - least(v_count, p_max), 0),
    v_reset_at;
end;
$$;

drop trigger if exists set_products_updated_at on products;
create trigger set_products_updated_at
before update on products
for each row execute function set_updated_at();

drop trigger if exists set_inventory_updated_at on inventory;
create trigger set_inventory_updated_at
before update on inventory
for each row execute function set_updated_at();

drop trigger if exists set_site_settings_updated_at on site_settings;
create trigger set_site_settings_updated_at
before update on site_settings
for each row execute function set_updated_at();

drop trigger if exists set_shipments_updated_at on shipments;
create trigger set_shipments_updated_at
before update on shipments
for each row execute function set_updated_at();

drop trigger if exists set_email_jobs_updated_at on email_jobs;
create trigger set_email_jobs_updated_at
before update on email_jobs
for each row execute function set_updated_at();

create or replace function record_paid_order(
  p_session_id text,
  p_payment_reference text,
  p_payment_provider text,
  p_fulfillment text,
  p_currency text,
  p_amount_subtotal integer,
  p_amount_tax integer,
  p_amount_shipping integer,
  p_amount_total integer,
  p_customer jsonb,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_created_at timestamptz := coalesce(
    nullif(trim(both from coalesce(p_customer->>'placed_at', '')), '')::timestamptz,
    now()
  );
  v_requested_pickup_date date := case
    when p_fulfillment = 'market' then nullif(trim(both from coalesce(p_customer->>'pickup_date', '')), '')::date
    else null
  end;
  v_has_ready_pickup boolean := false;
  v_item jsonb;
  v_sku text;
  v_qty integer;
  v_price integer;
  v_available integer;
  v_preorder integer;
begin
  if nullif(trim(coalesce(p_session_id, '')), '') is null then
    raise exception 'A payment session id is required.';
  end if;

  -- Finalization and the Stripe webhook can arrive together. Serialize every
  -- attempt for this payment before checking for an existing order so only one
  -- transaction mutates inventory.
  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  select id into v_order_id
  from orders
  where payment_session_id = p_session_id;

  if v_order_id is not null then
    if p_fulfillment = 'market' and v_requested_pickup_date is not null then
      update orders o
        set pickup_date = v_requested_pickup_date
        where o.id = v_order_id
          and o.pickup_date is null
          and exists (
            select 1
            from order_items oi
            where oi.order_id = o.id
              and oi.quantity > oi.preorder_qty
          );
    end if;

    return v_order_id;
  end if;

  insert into orders (
    payment_session_id,
    payment_reference,
    payment_provider,
    status,
    fulfillment,
    customer_name,
    customer_email,
    customer_phone,
    address1,
    address2,
    city,
    state,
    postal_code,
    note,
    currency,
    amount_subtotal,
    amount_tax,
    amount_shipping,
    amount_total,
    shipping_tier,
    shipping_option,
    shipping_option_label,
    shipping_estimate,
    sauerkraut_count,
    hot_sauce_count,
    pickup_date,
    created_at
  ) values (
    p_session_id,
    nullif(p_payment_reference, ''),
    coalesce(nullif(p_payment_provider, ''), 'stripe'),
    'paid',
    p_fulfillment,
    coalesce(p_customer->>'name', ''),
    coalesce(p_customer->>'email', ''),
    nullif(p_customer->>'phone', ''),
    nullif(p_customer->>'address1', ''),
    nullif(p_customer->>'address2', ''),
    nullif(p_customer->>'city', ''),
    nullif(p_customer->>'state', ''),
    nullif(p_customer->>'postal_code', ''),
    nullif(p_customer->>'note', ''),
    coalesce(p_currency, 'usd'),
    coalesce(p_amount_subtotal, 0),
    coalesce(p_amount_tax, 0),
    coalesce(p_amount_shipping, 0),
    coalesce(p_amount_total, 0),
    nullif(p_customer->>'shipping_tier', ''),
    nullif(p_customer->>'shipping_option', ''),
    nullif(p_customer->>'shipping_option_label', ''),
    nullif(p_customer->>'shipping_estimate', ''),
    coalesce(nullif(p_customer->>'sauerkraut_count', '')::integer, 0),
    coalesce(nullif(p_customer->>'hot_sauce_count', '')::integer, 0),
    null,
    v_order_created_at
  )
  returning id into v_order_id;

  -- Lock inventory in a deterministic order so overlapping carts cannot
  -- deadlock when their JSON item arrays were submitted in different orders.
  for v_item in
    select item.value
    from jsonb_array_elements(p_items) as item(value)
    order by trim(both from coalesce(item.value->>'sku', ''))
  loop
    v_sku := trim(both from coalesce(v_item->>'sku', ''));
    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    v_price := coalesce((v_item->>'price_cents')::integer, 0);

    if v_sku = '' or v_qty <= 0 then
      continue;
    end if;

    select on_hand
      into v_available
      from inventory
      where sku = v_sku
      for update;

    if not found then
      raise exception 'Unknown SKU: %', v_sku;
    end if;

    v_preorder := greatest(v_qty - v_available, 0);
    if p_fulfillment = 'market' and (v_qty - v_preorder) > 0 then
      v_has_ready_pickup := true;
    end if;

    update inventory
      set on_hand = case when on_hand >= v_qty then on_hand - v_qty else 0 end,
          units_sold = units_sold + v_qty,
          preorders_remaining = preorders_remaining + v_preorder,
          updated_at = now()
      where sku = v_sku;

    insert into order_items (order_id, sku, quantity, price_cents, preorder_qty, created_at)
      values (v_order_id, v_sku, v_qty, v_price, v_preorder, v_order_created_at);

    if v_preorder > 0 then
      insert into preorder_queue (order_id, sku, quantity, remaining, created_at)
        values (v_order_id, v_sku, v_preorder, v_preorder, v_order_created_at);
    end if;
  end loop;

  if v_has_ready_pickup and v_requested_pickup_date is not null then
    update orders
      set pickup_date = v_requested_pickup_date
      where id = v_order_id;
  end if;

  return v_order_id;
end;
$$;
create or replace function record_paid_order(
  p_session_id text,
  p_payment_reference text,
  p_payment_provider text,
  p_fulfillment text,
  p_currency text,
  p_amount_subtotal integer,
  p_amount_tax integer,
  p_amount_shipping integer,
  p_amount_total integer,
  p_customer jsonb,
  p_items jsonb,
  p_is_test_order boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  v_order_id := record_paid_order(
    p_session_id,
    p_payment_reference,
    p_payment_provider,
    p_fulfillment,
    p_currency,
    p_amount_subtotal,
    p_amount_tax,
    p_amount_shipping,
    p_amount_total,
    p_customer,
    p_items
  );

  if coalesce(p_is_test_order, false) then
    update orders
      set is_test_order = true
      where id = v_order_id
        and not is_test_order;
  end if;

  return v_order_id;
end;
$$;


drop function if exists transition_stripe_order_state(uuid, text, timestamptz);

create or replace function transition_stripe_order_state(
  p_order_id uuid,
  p_target_status text,
  p_effective_at timestamptz default now(),
  p_retire_work boolean default true
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_target_status text := lower(trim(coalesce(p_target_status, '')));
  v_effective_at timestamptz := coalesce(p_effective_at, now());
  v_cancelled_preorders record;
begin
  if v_target_status not in ('paid', 'cancelled', 'refunded', 'disputed') then
    raise exception 'Unsupported Stripe order status transition: %', v_target_status;
  end if;

  select o.status
    into v_current_status
    from orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Unknown order id: %', p_order_id;
  end if;

  if v_current_status = 'refunded' and v_target_status in ('paid', 'disputed') then
    v_target_status := v_current_status;
  end if;

  if v_target_status = 'paid' and v_current_status not in ('paid', 'disputed') then
    raise exception 'Cannot restore order % to paid from status %', p_order_id, v_current_status;
  end if;

  if v_target_status = 'cancelled' and v_current_status not in ('pending', 'cancelled') then
    raise exception 'Cannot cancel order % from status %', p_order_id, v_current_status;
  end if;

  update orders
    set status = v_target_status
    where id = p_order_id
      and status <> v_target_status;

  if not coalesce(p_retire_work, true)
     or v_target_status not in ('cancelled', 'refunded', 'disputed') then
    return v_target_status;
  end if;

  perform i.sku
    from inventory i
    where exists (
      select 1
      from preorder_queue pq
      where pq.order_id = p_order_id
        and pq.sku = i.sku
        and pq.remaining > 0
    )
    order by i.sku
    for update;

  perform pq.id
    from preorder_queue pq
    where pq.order_id = p_order_id
      and pq.remaining > 0
    order by pq.sku, pq.created_at, pq.id
    for update;

  for v_cancelled_preorders in
    select pq.sku, sum(pq.remaining)::integer as quantity
    from preorder_queue pq
    where pq.order_id = p_order_id
      and pq.remaining > 0
    group by pq.sku
  loop
    update inventory i
      set preorders_remaining = greatest(
            i.preorders_remaining - v_cancelled_preorders.quantity,
            0
          ),
          updated_at = v_effective_at
      where i.sku = v_cancelled_preorders.sku;
  end loop;

  update preorder_queue
    set remaining = 0
    where order_id = p_order_id
      and remaining > 0;

  update shipments s
    set status = 'cancelled',
        updated_at = v_effective_at
    where s.order_id = p_order_id
      and s.status in ('pending_label', 'purchasing_label')
      and s.label_purchased_at is null
      and nullif(trim(coalesce(s.label_url, '')), '') is null
      and nullif(trim(coalesce(s.tracking_number, '')), '') is null
      and not exists (
        select 1
        from shipment_parcels sp
        where sp.shipment_id = s.id
          and sp.status in ('label_purchased', 'shipped', 'delivered')
      );

  update checkout_shipping_quotes q
    set status = 'cancelled',
        updated_at = v_effective_at
    from orders o
    where o.id = p_order_id
      and q.status = 'quoted'
      and q.payment_session_id in (o.payment_session_id, o.payment_reference);

  return v_target_status;
end;
$$;

create or replace function transition_stripe_order_state(
  p_order_id uuid,
  p_target_status text,
  p_effective_at timestamptz,
  p_retire_work boolean,
  p_observed_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_current_effective_at timestamptz;
  v_current_observed_at timestamptz;
  v_current_retire_work boolean;
  v_target_status text := lower(trim(coalesce(p_target_status, '')));
  v_effective_at timestamptz := coalesce(p_effective_at, clock_timestamp());
  v_observed_at timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_cancelled_preorders record;
begin
  if v_target_status not in ('paid', 'cancelled', 'refunded', 'disputed') then
    raise exception 'Unsupported Stripe order status transition: %', v_target_status;
  end if;

  select
      o.status,
      o.stripe_state_effective_at,
      o.stripe_state_observed_at,
      o.stripe_state_retire_work
    into
      v_current_status,
      v_current_effective_at,
      v_current_observed_at,
      v_current_retire_work
    from orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Unknown order id: %', p_order_id;
  end if;

  if v_current_status = 'refunded' and v_target_status in ('paid', 'disputed') then
    return v_current_status;
  end if;

  -- Order primarily by Stripe's event time. A response for an older event may
  -- finish later, so observation time is only a same-event-time tie-breaker.
  if v_current_effective_at is not null
     and v_effective_at < v_current_effective_at then
    return v_current_status;
  end if;

  if v_current_effective_at is not null
     and v_effective_at = v_current_effective_at
     and v_current_observed_at is not null
     and v_observed_at < v_current_observed_at then
    return v_current_status;
  end if;

  if v_current_effective_at is not null
     and v_effective_at = v_current_effective_at
     and v_current_observed_at is not null
     and v_observed_at = v_current_observed_at
     and (
       case
         when v_target_status = 'refunded' then 50
         when v_target_status = 'disputed' and coalesce(p_retire_work, true) then 40
         when v_target_status = 'disputed' then 30
         when v_target_status = 'paid' then 20
         when v_target_status = 'cancelled' then 10
         else 0
       end
     ) <= (
       case
         when v_current_status = 'refunded' then 50
         when v_current_status = 'disputed' and coalesce(v_current_retire_work, false) then 40
         when v_current_status = 'disputed' then 30
         when v_current_status = 'paid' then 20
         when v_current_status = 'cancelled' then 10
         else 0
       end
     ) then
    return v_current_status;
  end if;

  if v_target_status = 'paid' and v_current_status not in ('paid', 'disputed') then
    raise exception 'Cannot restore order % to paid from status %', p_order_id, v_current_status;
  end if;

  if v_target_status = 'cancelled' and v_current_status not in ('pending', 'cancelled') then
    raise exception 'Cannot cancel order % from status %', p_order_id, v_current_status;
  end if;

  update orders
    set status = v_target_status,
        stripe_state_effective_at = v_effective_at,
        stripe_state_observed_at = v_observed_at,
        stripe_state_retire_work = (
          v_target_status = 'disputed' and coalesce(p_retire_work, true)
        ),
        stripe_fulfillment_retired_at = case
          when v_target_status in ('cancelled', 'refunded')
            or (v_target_status = 'disputed' and coalesce(p_retire_work, true))
            then coalesce(stripe_fulfillment_retired_at, v_effective_at)
          else stripe_fulfillment_retired_at
        end
    where id = p_order_id;

  if v_target_status = 'disputed' and not coalesce(p_retire_work, true) then
    update shipments s
      set status = 'pending_label',
          label_purchase_started_at = null,
          label_purchase_error = 'Label purchase paused because the payment is disputed.',
          updated_at = v_observed_at
      where s.order_id = p_order_id
        and s.status = 'purchasing_label';
  elsif v_target_status in ('cancelled', 'refunded')
        or (v_target_status = 'disputed' and coalesce(p_retire_work, true)) then
    update shipments s
      set status = 'cancelled',
          label_purchase_started_at = null,
          label_purchase_error = case
            when v_target_status = 'refunded'
              then 'Label purchase stopped because the payment was fully refunded.'
            when v_target_status = 'disputed'
              then 'Label purchase stopped because the payment dispute was lost.'
            else 'Label purchase stopped because the payment was cancelled.'
          end,
          updated_at = v_observed_at
      where s.order_id = p_order_id
        and s.status = 'purchasing_label';
  end if;

  if not coalesce(p_retire_work, true)
     or v_target_status not in ('cancelled', 'refunded', 'disputed') then
    return v_target_status;
  end if;

  perform i.sku
    from inventory i
    where exists (
      select 1
      from preorder_queue pq
      where pq.order_id = p_order_id
        and pq.sku = i.sku
        and pq.remaining > 0
    )
    order by i.sku
    for update;

  perform pq.id
    from preorder_queue pq
    where pq.order_id = p_order_id
      and pq.remaining > 0
    order by pq.sku, pq.created_at, pq.id
    for update;

  for v_cancelled_preorders in
    select pq.sku, sum(pq.remaining)::integer as quantity
    from preorder_queue pq
    where pq.order_id = p_order_id
      and pq.remaining > 0
    group by pq.sku
  loop
    update inventory i
      set preorders_remaining = greatest(
            i.preorders_remaining - v_cancelled_preorders.quantity,
            0
          ),
          updated_at = v_effective_at
      where i.sku = v_cancelled_preorders.sku;
  end loop;

  update preorder_queue
    set remaining = 0
    where order_id = p_order_id
      and remaining > 0;

  update shipments s
    set status = 'cancelled',
        updated_at = v_effective_at
    where s.order_id = p_order_id
      and s.status in ('pending_label', 'purchasing_label')
      and s.label_purchased_at is null
      and nullif(trim(coalesce(s.label_url, '')), '') is null
      and nullif(trim(coalesce(s.tracking_number, '')), '') is null
      and not exists (
        select 1
        from shipment_parcels sp
        where sp.shipment_id = s.id
          and sp.status in ('label_purchased', 'shipped', 'delivered')
      );

  update checkout_shipping_quotes q
    set status = 'cancelled',
        updated_at = v_effective_at
    from orders o
    where o.id = p_order_id
      and q.status = 'quoted'
      and q.payment_session_id in (o.payment_session_id, o.payment_reference);

  return v_target_status;
end;
$$;

create or replace function transition_stripe_order_state(
  p_order_id uuid,
  p_target_status text,
  p_effective_at timestamptz default now(),
  p_retire_work boolean default true
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return transition_stripe_order_state(
    p_order_id,
    p_target_status,
    p_effective_at,
    p_retire_work,
    clock_timestamp()
  );
end;
$$;

create or replace function record_stripe_order_state(
  p_session_id text,
  p_payment_reference text,
  p_payment_provider text,
  p_fulfillment text,
  p_currency text,
  p_amount_subtotal integer,
  p_amount_tax integer,
  p_amount_shipping integer,
  p_amount_total integer,
  p_customer jsonb,
  p_items jsonb,
  p_is_test_order boolean,
  p_target_status text,
  p_state_effective_at timestamptz,
  p_state_observed_at timestamptz,
  p_retire_work boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_initial_state_unset boolean := false;
  v_final_status text;
  v_fulfillment_retired boolean := false;
  v_released record;
begin
  v_order_id := record_paid_order(
    p_session_id,
    p_payment_reference,
    p_payment_provider,
    p_fulfillment,
    p_currency,
    p_amount_subtotal,
    p_amount_tax,
    p_amount_shipping,
    p_amount_total,
    p_customer,
    p_items,
    p_is_test_order
  );

  select o.stripe_state_effective_at is null
    into v_initial_state_unset
    from orders o
    where o.id = v_order_id
    for update;

  v_final_status := transition_stripe_order_state(
    v_order_id,
    p_target_status,
    p_state_effective_at,
    p_retire_work,
    p_state_observed_at
  );

  if coalesce(v_initial_state_unset, false)
     and (
       v_final_status = 'refunded'
       or (v_final_status = 'disputed' and coalesce(p_retire_work, true))
     ) then
    for v_released in
      select
        oi.sku,
        sum(oi.quantity - oi.preorder_qty)::integer as in_stock_quantity,
        sum(oi.quantity)::integer as total_quantity
      from order_items oi
      where oi.order_id = v_order_id
      group by oi.sku
      order by oi.sku
    loop
      update inventory i
        set on_hand = i.on_hand + greatest(v_released.in_stock_quantity, 0),
            units_sold = greatest(i.units_sold - v_released.total_quantity, 0),
            updated_at = coalesce(p_state_observed_at, clock_timestamp())
        where i.sku = v_released.sku;
    end loop;
  end if;

  select o.stripe_fulfillment_retired_at is not null
    into v_fulfillment_retired
    from orders o
    where o.id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'status', v_final_status,
    'fulfillment_retired', coalesce(v_fulfillment_retired, false)
  );
end;
$$;

create or replace function sync_shipment_for_order(
  p_order_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_items_json jsonb := '[]'::jsonb;
  v_items_summary text := '';
  v_item_count integer := 0;
  v_shipment_id uuid;
begin
  select *
    into v_order
    from orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Unknown order id: %', p_order_id;
  end if;

  if coalesce(v_order.is_test_order, false) then
    update shipments s
      set status = 'cancelled',
          label_purchase_started_at = null,
          label_purchase_error = 'Automatic label purchase disabled for a financial test order.',
          updated_at = now()
      where s.order_id = v_order.id
        and s.status in ('pending_label', 'purchasing_label')
        and s.label_purchased_at is null
        and nullif(trim(coalesce(s.label_url, '')), '') is null
        and nullif(trim(coalesce(s.tracking_number, '')), '') is null
        and not exists (
          select 1
          from shipment_parcels sp
          where sp.shipment_id = s.id
            and sp.status in ('label_purchased', 'shipped', 'delivered')
        );
    return null;
  end if;

  if v_order.fulfillment = 'ship' and v_order.status = 'disputed' then
    update shipments s
      set status = 'pending_label',
          label_purchase_started_at = null,
          label_purchase_error = 'Label purchase paused while the payment dispute is open.',
          updated_at = now()
      where s.order_id = v_order.id
        and s.status = 'purchasing_label';
    return null;
  end if;

  if v_order.fulfillment <> 'ship' or v_order.status <> 'paid' then
    update shipments s
      set status = 'cancelled',
          updated_at = now()
      where s.order_id = v_order.id
        and s.status in ('pending_label', 'purchasing_label')
        and s.label_purchased_at is null
        and nullif(trim(coalesce(s.label_url, '')), '') is null
        and nullif(trim(coalesce(s.tracking_number, '')), '') is null
        and not exists (
          select 1
          from shipment_parcels sp
          where sp.shipment_id = s.id
            and sp.status in ('label_purchased', 'shipped', 'delivered')
        );
    return null;
  end if;

  if exists (
    select 1
      from preorder_queue pq
      where pq.order_id = v_order.id
        and pq.remaining > 0
  ) then
    delete from shipments s
      where s.order_id = v_order.id
        and s.status = 'pending_label'
        and s.label_purchased_at is null
        and nullif(trim(coalesce(s.label_url, '')), '') is null
        and nullif(trim(coalesce(s.tracking_number, '')), '') is null
        and not exists (
          select 1
          from shipment_parcels sp
          where sp.shipment_id = s.id
            and sp.status in ('label_purchased', 'shipped', 'delivered')
        );
    update shipments s
      set status = 'cancelled',
          updated_at = now()
      where s.order_id = v_order.id
        and s.status = 'purchasing_label'
        and s.label_purchased_at is null
        and nullif(trim(coalesce(s.label_url, '')), '') is null
        and nullif(trim(coalesce(s.tracking_number, '')), '') is null
        and not exists (
          select 1
          from shipment_parcels sp
          where sp.shipment_id = s.id
            and sp.status in ('label_purchased', 'shipped', 'delivered')
        );
    return null;
  end if;

  update shipments s
    set label_purchase_error = null,
        updated_at = now()
    where s.order_id = v_order.id
      and s.status = 'pending_label'
      and s.label_purchase_error = 'Label purchase paused until all preorder items are ready.';

  select s.id
    into v_shipment_id
    from shipments s
    where s.order_id = v_order.id
      and (
        s.status in ('purchasing_label', 'label_purchased', 'shipped', 'delivered')
        or (
          s.status = 'cancelled'
          and (
            s.label_purchased_at is not null
            or nullif(trim(coalesce(s.label_url, '')), '') is not null
            or nullif(trim(coalesce(s.tracking_number, '')), '') is not null
            or exists (
              select 1
              from shipment_parcels sp
              where sp.shipment_id = s.id
                and sp.status in ('label_purchased', 'shipped', 'delivered')
            )
          )
        )
      );

  if v_shipment_id is not null then
    return v_shipment_id;
  end if;

  update shipments s
    set status = 'pending_label',
        label_purchase_started_at = null,
        label_purchase_error = null,
        updated_at = now()
    where s.order_id = v_order.id
      and s.status = 'cancelled'
      and s.label_purchased_at is null
      and nullif(trim(coalesce(s.label_url, '')), '') is null
      and nullif(trim(coalesce(s.tracking_number, '')), '') is null
      and not exists (
        select 1
        from shipment_parcels sp
        where sp.shipment_id = s.id
          and sp.status in ('label_purchased', 'shipped', 'delivered')
      );

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sku', oi.sku,
          'name', coalesce(p.name, oi.sku),
          'quantity', oi.quantity,
          'price_cents', oi.price_cents,
          'line_total_cents', oi.quantity * oi.price_cents
        )
        order by oi.created_at, oi.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      string_agg(
        format('%s x%s', coalesce(p.name, oi.sku), oi.quantity),
        ', '
        order by oi.created_at, oi.id
      ),
      ''
    ),
    coalesce(sum(oi.quantity), 0)
    into v_items_json, v_items_summary, v_item_count
    from order_items oi
    left join products p on p.sku = oi.sku
    where oi.order_id = v_order.id;

  if v_item_count <= 0 then
    raise exception 'Shipping order % has no items', p_order_id;
  end if;

  insert into shipments (
    order_id,
    payment_session_id,
    payment_reference,
    status,
    customer_name,
    customer_email,
    customer_phone,
    address1,
    address2,
    city,
    state,
    postal_code,
    country,
    items_summary,
    items_json,
    item_count,
    amount_total,
    currency,
    shipping_tier,
    shipping_option,
    shipping_option_label,
    shipping_estimate,
    sauerkraut_count,
    hot_sauce_count
  ) values (
    v_order.id,
    v_order.payment_session_id,
    v_order.payment_reference,
    'pending_label',
    coalesce(v_order.customer_name, ''),
    coalesce(v_order.customer_email, ''),
    nullif(v_order.customer_phone, ''),
    coalesce(v_order.address1, ''),
    nullif(v_order.address2, ''),
    coalesce(v_order.city, ''),
    coalesce(v_order.state, ''),
    coalesce(v_order.postal_code, ''),
    'US',
    v_items_summary,
    v_items_json,
    v_item_count,
    coalesce(v_order.amount_total, 0),
    upper(coalesce(v_order.currency, 'USD')),
    nullif(v_order.shipping_tier, ''),
    nullif(v_order.shipping_option, ''),
    nullif(v_order.shipping_option_label, ''),
    nullif(v_order.shipping_estimate, ''),
    coalesce(v_order.sauerkraut_count, 0),
    coalesce(v_order.hot_sauce_count, 0)
  )
  on conflict (order_id) do update set
    payment_session_id = excluded.payment_session_id,
    payment_reference = excluded.payment_reference,
    customer_name = excluded.customer_name,
    customer_email = excluded.customer_email,
    customer_phone = excluded.customer_phone,
    address1 = excluded.address1,
    address2 = excluded.address2,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    country = excluded.country,
    items_summary = excluded.items_summary,
    items_json = excluded.items_json,
    item_count = excluded.item_count,
    amount_total = excluded.amount_total,
    currency = excluded.currency,
    shipping_tier = excluded.shipping_tier,
    shipping_option = excluded.shipping_option,
    shipping_option_label = excluded.shipping_option_label,
    shipping_estimate = excluded.shipping_estimate,
    sauerkraut_count = excluded.sauerkraut_count,
    hot_sauce_count = excluded.hot_sauce_count,
    updated_at = now()
  where shipments.status = 'pending_label'
  returning id into v_shipment_id;

  if v_shipment_id is null then
    select s.id into v_shipment_id
      from shipments s
      where s.order_id = v_order.id;
  end if;

  return v_shipment_id;
end;
$$;

create or replace function sync_all_shipments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_shipment_id uuid;
  v_synced integer := 0;
  v_test_synced integer := 0;
begin
  insert into shipments (
    order_id, payment_session_id, payment_reference, status,
    customer_name, customer_email, customer_phone,
    address1, address2, city, state, postal_code, country,
    items_summary, items_json, item_count, amount_total, currency,
    shipping_tier, shipping_option, shipping_option_label, shipping_estimate,
    sauerkraut_count, hot_sauce_count, label_purchase_error
  )
  select
    o.id, o.payment_session_id, o.payment_reference, 'cancelled',
    coalesce(o.customer_name, ''), coalesce(o.customer_email, ''),
    nullif(o.customer_phone, ''), coalesce(o.address1, ''),
    nullif(o.address2, ''), coalesce(o.city, ''), coalesce(o.state, ''),
    coalesce(o.postal_code, ''), 'US', item_summary.items_summary,
    item_summary.items_json, item_summary.item_count,
    coalesce(o.amount_total, 0), upper(coalesce(o.currency, 'USD')),
    nullif(o.shipping_tier, ''), nullif(o.shipping_option, ''),
    nullif(o.shipping_option_label, ''), nullif(o.shipping_estimate, ''),
    coalesce(o.sauerkraut_count, 0), coalesce(o.hot_sauce_count, 0),
    'Financial test order — visible for reporting only; label purchase and tracking are disabled.'
  from orders o
  cross join lateral (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'sku', oi.sku, 'name', coalesce(p.name, oi.sku),
        'quantity', oi.quantity, 'price_cents', oi.price_cents,
        'line_total_cents', oi.quantity * oi.price_cents
      ) order by oi.created_at, oi.id), '[]'::jsonb) as items_json,
      coalesce(string_agg(format('%s x%s', coalesce(p.name, oi.sku), oi.quantity), ', '
        order by oi.created_at, oi.id), '') as items_summary,
      coalesce(sum(oi.quantity), 0)::integer as item_count
    from order_items oi
    left join products p on p.sku = oi.sku
    where oi.order_id = o.id
  ) item_summary
  where o.fulfillment = 'ship'
    and o.status = 'paid'
    and coalesce(o.is_test_order, false)
    and item_summary.item_count > 0
    and not exists (select 1 from shipments s where s.order_id = o.id)
  order by o.created_at, o.id
  limit 100
  on conflict (order_id) do nothing;

  get diagnostics v_test_synced = row_count;
  v_synced := v_test_synced;

  for v_order_id in
    select o.id
    from orders o
    where o.fulfillment = 'ship'
      and o.status = 'paid'
      and not coalesce(o.is_test_order, false)
      and not exists (
        select 1
        from preorder_queue pq
        where pq.order_id = o.id
          and pq.remaining > 0
      )
      and (
        not exists (
          select 1
          from shipments s
          where s.order_id = o.id
        )
        or exists (
          select 1
          from shipments s
          where s.order_id = o.id
            and s.status = 'pending_label'
            and s.label_purchase_error =
              'Label purchase paused until all preorder items are ready.'
        )
        or exists (
          select 1
          from shipments s
          where s.order_id = o.id
            and s.status = 'cancelled'
            and s.label_purchased_at is null
            and nullif(trim(coalesce(s.label_url, '')), '') is null
            and nullif(trim(coalesce(s.tracking_number, '')), '') is null
            and not exists (
              select 1
              from shipment_parcels sp
              where sp.shipment_id = s.id
                and sp.status in ('label_purchased', 'shipped', 'delivered')
            )
        )
      )
    order by o.created_at, o.id
    limit 100
  loop
    v_shipment_id := sync_shipment_for_order(v_order_id);
    if v_shipment_id is not null then
      v_synced := v_synced + 1;
    end if;
  end loop;

  return v_synced;
end;
$$;

update shipments s
  set status = 'cancelled',
      label_purchase_started_at = null,
      label_purchase_error = 'Automatic label purchase disabled for a financial test order.',
      updated_at = now()
from orders o
where o.id = s.order_id
  and coalesce(o.is_test_order, false)
  and s.status in ('pending_label', 'purchasing_label')
  and s.label_purchased_at is null
  and nullif(trim(coalesce(s.label_url, '')), '') is null
  and nullif(trim(coalesce(s.tracking_number, '')), '') is null
  and not exists (
    select 1
    from shipment_parcels sp
    where sp.shipment_id = s.id
      and sp.status in ('label_purchased', 'shipped', 'delivered')
  );

create or replace function enqueue_order_confirmation_email(
  p_order_id uuid,
  p_payload jsonb,
  p_claim_token uuid,
  p_message_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_message_id text := trim(coalesce(p_message_id, ''));
  v_order orders%rowtype;
  v_existing email_jobs%rowtype;
  v_job_id uuid;
begin
  if p_order_id is null or p_claim_token is null then
    raise exception 'An order id and claim token are required.';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The order confirmation payload must be a JSON object.';
  end if;

  if length(v_message_id) not between 3 and 320
     or v_message_id ~ E'[\\r\\n]' then
    raise exception 'The order confirmation Message-ID is invalid.';
  end if;

  select *
    into v_order
    from orders o
    where o.id = p_order_id
    for update;

  if not found
     or v_order.customer_confirmation_email_sent_at is not null
     or v_order.status <> 'paid'
     or v_order.stripe_fulfillment_retired_at is not null then
    return null;
  end if;

  select ej.*
    into v_existing
    from email_jobs ej
    where ej.order_id = p_order_id
      and ej.type = 'order_confirmation'
      and ej.status in ('pending', 'processing')
    order by ej.created_at, ej.id
    limit 1
    for update;

  if found then
    update orders
      set customer_confirmation_email_claimed_at = v_existing.claimed_at,
          customer_confirmation_email_claim_token = v_existing.claim_token
      where id = p_order_id;
    return v_existing.id;
  end if;

  -- SMTP exhaustion and malformed payloads still require an explicit producer
  -- retry. An order_ineligible failure consumed no SMTP attempt, so a safely
  -- recovered dispute may atomically requeue that one terminal outcome.
  select ej.*
    into v_existing
    from email_jobs ej
    where ej.order_id = p_order_id
      and ej.type = 'order_confirmation'
      and ej.status = 'failed'
    order by ej.processed_at desc nulls last, ej.created_at desc, ej.id desc
    limit 1
    for update;

  if found then
    if v_existing.last_error_code = 'order_ineligible'
       and v_order.stripe_fulfillment_retired_at is null then
      update email_jobs
        set status = 'pending',
            payload = p_payload || jsonb_build_object('orderId', p_order_id::text),
            available_at = v_now,
            processed_at = null,
            claimed_at = v_now,
            claim_token = p_claim_token,
            last_error_code = null,
            last_error = null
        where id = v_existing.id;

      update orders
        set customer_confirmation_email_claimed_at = v_now,
            customer_confirmation_email_claim_token = p_claim_token
        where id = p_order_id;
    end if;

    return v_existing.id;
  end if;

  -- Respect an in-flight legacy/direct-delivery claim for 30 minutes. Stale
  -- orphan claims are recovered by the atomic insert below.
  if v_order.customer_confirmation_email_claimed_at is not null
     and v_order.customer_confirmation_email_claimed_at > v_now - interval '30 minutes'
     and v_order.customer_confirmation_email_claim_token is distinct from p_claim_token then
    return null;
  end if;

  insert into email_jobs (
    type,
    status,
    order_id,
    payload,
    available_at,
    claimed_at,
    claim_token,
    message_id
  ) values (
    'order_confirmation',
    'pending',
    p_order_id,
    p_payload || jsonb_build_object('orderId', p_order_id::text),
    v_now,
    v_now,
    p_claim_token,
    v_message_id
  )
  returning id into v_job_id;

  update orders
    set customer_confirmation_email_claimed_at = v_now,
        customer_confirmation_email_claim_token = p_claim_token
    where id = p_order_id;

  return v_job_id;
end;
$$;

create or replace function claim_email_job(
  p_job_id uuid,
  p_stale_before timestamptz,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid;
  v_order orders%rowtype;
  v_job email_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null or p_stale_before is null then
    return null;
  end if;

  select ej.order_id
    into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return null;
  end if;

  -- Lock order first in every queue RPC to prevent order/job deadlocks.
  select *
    into v_order
    from orders o
    where o.id = v_order_id
    for update;

  if not found then
    return null;
  end if;

  select *
    into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.type <> 'order_confirmation'
     or v_job.attempts >= v_job.max_attempts then
    return null;
  end if;

  if v_order.customer_confirmation_email_sent_at is not null then
    update email_jobs
      set status = 'sent',
          processed_at = coalesce(processed_at, v_order.customer_confirmation_email_sent_at),
          claim_token = null,
          claimed_at = null,
          last_error_code = null,
          last_error = null
      where id = v_job.id;
    update orders
      set customer_confirmation_email_claim_token = null,
          customer_confirmation_email_claimed_at = null
      where id = v_order.id;
    return null;
  end if;

  if v_order.status <> 'paid'
     or v_order.stripe_fulfillment_retired_at is not null then
    update email_jobs
      set status = 'failed',
          processed_at = v_now,
          claim_token = null,
          claimed_at = null,
          last_error_code = 'order_ineligible',
          last_error = 'The order is no longer eligible for confirmation delivery.'
      where id = v_job.id;
    update orders
      set customer_confirmation_email_claim_token = null,
          customer_confirmation_email_claimed_at = null
      where id = v_order.id;
    return null;
  end if;

  if not (
    (v_job.status = 'pending' and v_job.available_at <= v_now)
    or (
      v_job.status = 'processing'
      and v_job.claimed_at is not null
      and v_job.claimed_at <= p_stale_before
    )
  ) then
    return null;
  end if;

  update email_jobs
    set status = 'processing',
        claim_token = p_claim_token,
        claimed_at = v_now,
        processed_at = null,
        last_error_code = null,
        last_error = null
    where id = v_job.id
    returning * into v_job;

  update orders
    set customer_confirmation_email_claim_token = p_claim_token,
        customer_confirmation_email_claimed_at = v_now
    where id = v_order.id;

  return jsonb_build_object(
    'id', v_job.id,
    'type', v_job.type,
    'order_id', v_job.order_id,
    'payload', v_job.payload,
    'attempts', v_job.attempts,
    'max_attempts', v_job.max_attempts,
    'message_id', v_job.message_id,
    'claim_token', v_job.claim_token
  );
end;
$$;

create or replace function reschedule_or_fail_email_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error text,
  p_consume_attempt boolean,
  p_next_available_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid;
  v_job email_jobs%rowtype;
  v_error_code text := left(
    coalesce(nullif(lower(trim(p_error_code)), ''), 'delivery_failed'),
    80
  );
  v_error text := left(trim(coalesce(p_error, 'Email delivery failed.')), 1000);
  v_attempts integer;
  v_terminal boolean;
  v_status text;
begin
  if p_job_id is null or p_claim_token is null then
    return null;
  end if;

  select ej.order_id into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return null;
  end if;

  perform o.id from orders o where o.id = v_order_id for update;
  if not found then
    return null;
  end if;

  select * into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.claim_token is distinct from p_claim_token then
    return null;
  end if;

  v_attempts := v_job.attempts + case when coalesce(p_consume_attempt, false) then 1 else 0 end;
  v_terminal := v_error_code in ('invalid_payload', 'unknown_job_type', 'order_ineligible')
    or v_attempts >= v_job.max_attempts;
  v_status := case when v_terminal then 'failed' else 'pending' end;

  update email_jobs
    set status = v_status,
        attempts = v_attempts,
        available_at = case
          when v_terminal then v_now
          else greatest(coalesce(p_next_available_at, v_now), v_now)
        end,
        processed_at = case when v_terminal then v_now else null end,
        claim_token = null,
        claimed_at = null,
        last_error_code = nullif(v_error_code, ''),
        last_error = nullif(v_error, '')
    where id = v_job.id;

  update orders
    set customer_confirmation_email_claim_token = null,
        customer_confirmation_email_claimed_at = null
    where id = v_order_id
      and customer_confirmation_email_claim_token = p_claim_token;

  return jsonb_build_object(
    'id', v_job.id,
    'status', v_status,
    'attempts', v_attempts,
    'max_attempts', v_job.max_attempts,
    'terminal', v_terminal,
    'exhausted', v_terminal,
    'available_at', case
      when v_terminal then v_now
      else greatest(coalesce(p_next_available_at, v_now), v_now)
    end
  );
end;
$$;

create or replace function complete_email_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_sent_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent_at timestamptz := coalesce(p_sent_at, clock_timestamp());
  v_order_id uuid;
  v_order orders%rowtype;
  v_job email_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null then
    return false;
  end if;

  select ej.order_id into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return false;
  end if;

  select * into v_order
    from orders o
    where o.id = v_order_id
    for update;

  if not found then
    return false;
  end if;

  select * into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.claim_token is distinct from p_claim_token
     or v_order.customer_confirmation_email_claim_token is distinct from p_claim_token then
    return false;
  end if;

  update orders
    set customer_confirmation_email_sent_at = coalesce(customer_confirmation_email_sent_at, v_sent_at),
        customer_confirmation_email_claimed_at = null,
        customer_confirmation_email_claim_token = null
    where id = v_order_id;

  update email_jobs
    set status = 'sent',
        processed_at = v_sent_at,
        claimed_at = null,
        claim_token = null,
        last_error_code = null,
        last_error = null
    where id = v_job.id;

  return true;
end;
$$;

create or replace function retry_failed_email_job(
  p_job_id uuid,
  p_available_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid;
  v_order orders%rowtype;
  v_job email_jobs%rowtype;
  v_claim_token uuid := gen_random_uuid();
begin
  if p_job_id is null then
    return false;
  end if;

  select ej.order_id into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return false;
  end if;

  select * into v_order
    from orders o
    where o.id = v_order_id
    for update;

  if not found
     or v_order.status <> 'paid'
     or v_order.stripe_fulfillment_retired_at is not null
     or v_order.customer_confirmation_email_sent_at is not null then
    return false;
  end if;

  select * into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.type <> 'order_confirmation'
     or v_job.status <> 'failed'
     or exists (
       select 1
       from email_jobs active_job
       where active_job.order_id = v_order_id
         and active_job.type = 'order_confirmation'
         and active_job.status in ('pending', 'processing')
         and active_job.id <> v_job.id
     ) then
    return false;
  end if;

  update email_jobs
    set status = 'pending',
        attempts = 0,
        available_at = greatest(coalesce(p_available_at, v_now), v_now),
        processed_at = null,
        claimed_at = v_now,
        claim_token = v_claim_token,
        last_error_code = null,
        last_error = null
    where id = v_job.id;

  update orders
    set customer_confirmation_email_claimed_at = v_now,
        customer_confirmation_email_claim_token = v_claim_token
    where id = v_order_id;

  return true;
end;
$$;

create or replace function claim_preorder_ready_email_events(
  p_order_id uuid,
  p_event_ids uuid[],
  p_claim_token uuid,
  p_stale_before timestamptz,
  p_cutoff timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_ids uuid[];
  v_unsent_ids uuid[];
  v_all_old_enough boolean;
  v_all_claimable boolean;
  v_updated integer := 0;
begin
  if p_order_id is null
     or p_claim_token is null
     or p_stale_before is null
     or p_cutoff is null
     or coalesce(cardinality(p_event_ids), 0) = 0 then
    return false;
  end if;

  select array_agg(distinct event_id order by event_id)
    into v_requested_ids
    from unnest(p_event_ids) as requested(event_id)
    where event_id is not null;

  if coalesce(cardinality(v_requested_ids), 0) <> cardinality(p_event_ids) then
    return false;
  end if;

  -- The order lock serializes claims and also prevents a concurrent FK insert
  -- from adding a release event between the exact-set check and claim update.
  perform o.id
    from orders o
    where o.id = p_order_id
      and o.status = 'paid'
    for update;

  if not found then
    return false;
  end if;

  perform pre.id
    from preorder_release_events pre
    where pre.order_id = p_order_id
      and pre.ready_pickup_email_sent_at is null
    order by pre.id
    for update;

  select
    array_agg(pre.id order by pre.id),
    bool_and(pre.created_at <= p_cutoff),
    bool_and(
      pre.ready_pickup_email_claim_token is null
      or pre.ready_pickup_email_claim_token = p_claim_token
      or pre.ready_pickup_email_claimed_at is null
      or pre.ready_pickup_email_claimed_at <= p_stale_before
    )
    into v_unsent_ids, v_all_old_enough, v_all_claimable
    from preorder_release_events pre
    where pre.order_id = p_order_id
      and pre.ready_pickup_email_sent_at is null;

  if coalesce(cardinality(v_unsent_ids), 0) = 0
     or v_requested_ids is distinct from v_unsent_ids
     or not coalesce(v_all_old_enough, false)
     or not coalesce(v_all_claimable, false) then
    return false;
  end if;

  update preorder_release_events
    set ready_pickup_email_claim_token = p_claim_token,
        ready_pickup_email_claimed_at = clock_timestamp()
    where order_id = p_order_id
      and id = any(v_unsent_ids)
      and ready_pickup_email_sent_at is null;
  get diagnostics v_updated = row_count;

  return v_updated = cardinality(v_unsent_ids);
end;
$$;

create or replace function release_preorder_ready_email_events(
  p_event_ids uuid[],
  p_claim_token uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_ids uuid[];
  v_matching_ids uuid[];
  v_updated integer := 0;
begin
  if p_claim_token is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    return 0;
  end if;

  select array_agg(distinct event_id order by event_id)
    into v_requested_ids
    from unnest(p_event_ids) as requested(event_id)
    where event_id is not null;

  if coalesce(cardinality(v_requested_ids), 0) <> cardinality(p_event_ids) then
    return 0;
  end if;

  perform pre.id
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
    order by pre.id
    for update;

  select array_agg(pre.id order by pre.id)
    into v_matching_ids
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
      and pre.ready_pickup_email_sent_at is null
      and pre.ready_pickup_email_claim_token = p_claim_token;

  if v_matching_ids is distinct from v_requested_ids then
    return 0;
  end if;

  update preorder_release_events
    set ready_pickup_email_claim_token = null,
        ready_pickup_email_claimed_at = null
    where id = any(v_requested_ids)
      and ready_pickup_email_sent_at is null
      and ready_pickup_email_claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function complete_preorder_ready_email_events(
  p_event_ids uuid[],
  p_claim_token uuid,
  p_sent_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_ids uuid[];
  v_matching_ids uuid[];
  v_updated integer := 0;
begin
  if p_claim_token is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    return 0;
  end if;

  select array_agg(distinct event_id order by event_id)
    into v_requested_ids
    from unnest(p_event_ids) as requested(event_id)
    where event_id is not null;

  if coalesce(cardinality(v_requested_ids), 0) <> cardinality(p_event_ids) then
    return 0;
  end if;

  perform pre.id
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
    order by pre.id
    for update;

  select array_agg(pre.id order by pre.id)
    into v_matching_ids
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
      and pre.ready_pickup_email_sent_at is null
      and pre.ready_pickup_email_claim_token = p_claim_token;

  if v_matching_ids is distinct from v_requested_ids then
    return 0;
  end if;

  update preorder_release_events
    set ready_pickup_email_sent_at = coalesce(p_sent_at, clock_timestamp()),
        ready_pickup_email_claim_token = null,
        ready_pickup_email_claimed_at = null
    where id = any(v_requested_ids)
      and ready_pickup_email_sent_at is null
      and ready_pickup_email_claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function get_admin_prep_data(
  p_pickup_date date,
  p_collection_start_at timestamptz,
  p_collection_end_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prep jsonb := '[]'::jsonb;
  v_pickup_orders jsonb := '[]'::jsonb;
begin
  with count_rows as (
    select
      oi.sku,
      coalesce(p.name, oi.sku) as name,
      coalesce(p.sort_order, 999999) as sort_order,
      case when o.fulfillment = 'ship' then greatest(oi.quantity - oi.preorder_qty, 0) else 0 end as shipping_qty,
      case when o.fulfillment = 'market' then greatest(oi.quantity - oi.preorder_qty, 0) else 0 end as market_qty,
      case when o.fulfillment = 'ship' then least(greatest(oi.preorder_qty, 0), oi.quantity) else 0 end as shipping_preorder_qty,
      case when o.fulfillment = 'market' then least(greatest(oi.preorder_qty, 0), oi.quantity) else 0 end as market_preorder_qty,
      least(greatest(oi.preorder_qty, 0), oi.quantity) as preorder_qty
    from order_items oi
    join orders o on o.id = oi.order_id
    left join products p on p.sku = oi.sku
    where o.status = 'paid'
      and (
        (
          o.fulfillment = 'market'
          and (
            (
              o.pickup_date = p_pickup_date
              and greatest(oi.quantity - oi.preorder_qty, 0) > 0
            )
            or (
              o.created_at >= p_collection_start_at
              and o.created_at < p_collection_end_at
              and least(greatest(oi.preorder_qty, 0), oi.quantity) > 0
            )
          )
        )
        or (
          o.fulfillment <> 'market'
          and o.created_at >= p_collection_start_at
          and o.created_at < p_collection_end_at
        )
      )

    union all

    select
      pre.sku,
      coalesce(p.name, pre.sku) as name,
      coalesce(p.sort_order, 999999) as sort_order,
      case when o.fulfillment = 'market' then 0 else pre.quantity end as shipping_qty,
      case when o.fulfillment = 'market' then pre.quantity else 0 end as market_qty,
      0 as shipping_preorder_qty,
      0 as market_preorder_qty,
      0 as preorder_qty
    from preorder_release_events pre
    join orders o on o.id = pre.order_id
    left join products p on p.sku = pre.sku
    where o.status = 'paid'
      and coalesce(pre.ready_pickup_email_sent_at, pre.created_at) >= p_collection_start_at
      and coalesce(pre.ready_pickup_email_sent_at, pre.created_at) < p_collection_end_at
  ),
  prep_rows as (
    select
      sku,
      max(name) as name,
      min(sort_order) as sort_order,
      sum(shipping_qty)::integer as shipping_qty,
      sum(market_qty)::integer as market_qty,
      sum(shipping_preorder_qty)::integer as shipping_preorder_qty,
      sum(market_preorder_qty)::integer as market_preorder_qty,
      sum(preorder_qty)::integer as preorder_qty,
      (sum(shipping_qty) + sum(market_qty))::integer as total_qty
    from count_rows
    group by sku
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sku', sku,
        'name', name,
        'shipping_qty', shipping_qty,
        'market_qty', market_qty,
        'shipping_preorder_qty', shipping_preorder_qty,
        'market_preorder_qty', market_preorder_qty,
        'preorder_qty', preorder_qty,
        'total_qty', total_qty
      )
      order by sort_order, name, sku
    ),
    '[]'::jsonb
  )
  into v_prep
  from prep_rows
  where total_qty > 0 or preorder_qty > 0;

  with pickup_items as (
    select
      o.id as order_id,
      o.created_at,
      o.customer_name,
      o.customer_email,
      o.customer_phone,
      o.pickup_date,
      oi.sku,
      coalesce(p.name, oi.sku) as name,
      greatest(oi.quantity - oi.preorder_qty, 0)::integer as quantity
    from order_items oi
    join orders o on o.id = oi.order_id
    left join products p on p.sku = oi.sku
    where o.status = 'paid'
      and o.fulfillment = 'market'
      and o.pickup_date = p_pickup_date
      and greatest(oi.quantity - oi.preorder_qty, 0) > 0

    union all

    select
      o.id as order_id,
      coalesce(pre.ready_pickup_email_sent_at, pre.created_at) as created_at,
      o.customer_name,
      o.customer_email,
      o.customer_phone,
      p_pickup_date as pickup_date,
      pre.sku,
      coalesce(p.name, pre.sku) as name,
      pre.quantity::integer as quantity
    from preorder_release_events pre
    join orders o on o.id = pre.order_id
    left join products p on p.sku = pre.sku
    where o.status = 'paid'
      and o.fulfillment = 'market'
      and coalesce(pre.ready_pickup_email_sent_at, pre.created_at) >= p_collection_start_at
      and coalesce(pre.ready_pickup_email_sent_at, pre.created_at) < p_collection_end_at
  ),
  grouped_items as (
    select
      order_id,
      min(created_at) as created_at,
      max(customer_name) as customer_name,
      max(customer_email) as customer_email,
      max(customer_phone) as customer_phone,
      max(pickup_date) as pickup_date,
      sku,
      max(name) as name,
      sum(quantity)::integer as quantity
    from pickup_items
    where quantity > 0
    group by order_id, sku
  ),
  grouped_orders as (
    select
      order_id,
      min(created_at) as created_at,
      max(customer_name) as customer_name,
      max(customer_email) as customer_email,
      max(customer_phone) as customer_phone,
      max(pickup_date) as pickup_date,
      sum(quantity)::integer as item_count,
      string_agg(format('%s x%s', name, quantity), ', ' order by name, sku) as items_summary,
      jsonb_agg(
        jsonb_build_object(
          'sku', sku,
          'name', name,
          'quantity', quantity
        )
        order by name, sku
      ) as items
    from grouped_items
    group by order_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', order_id::text,
        'created_at', created_at,
        'customer_name', customer_name,
        'customer_email', customer_email,
        'customer_phone', customer_phone,
        'pickup_date', pickup_date,
        'item_count', item_count,
        'items_summary', items_summary,
        'items', items
      )
      order by customer_name, created_at
    ),
    '[]'::jsonb
  )
  into v_pickup_orders
  from grouped_orders;

  return jsonb_build_object(
    'prep', v_prep,
    'pickup_orders', v_pickup_orders
  );
end;
$$;

create or replace function apply_restock(
  p_sku text,
  p_restock integer
) returns table (
  sku text,
  on_hand integer,
  preorders_remaining integer,
  units_sold integer,
  expected_restock_date date,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
  v_fulfilled integer := 0;
  v_existing_preorders integer := 0;
  v_applied_to_preorders integer := 0;
  v_queue_to_fulfill integer := 0;
  v_release_qty integer := 0;
  v_queue record;
begin
  select coalesce(i.preorders_remaining, 0)
    into v_existing_preorders
    from inventory i
    where i.sku = p_sku
    for update;

  if not found then
    raise exception 'Unknown SKU: %', p_sku;
  end if;

  if p_restock <> 0 then
    insert into restock_events (sku, restock_qty)
      values (p_sku, p_restock);
  end if;

  if p_restock < 0 then
    update inventory i
      set on_hand = greatest(i.on_hand + p_restock, 0),
          expected_restock_date = case
            when greatest(i.on_hand + p_restock, 0) > 0 then null
            else i.expected_restock_date
          end,
          updated_at = now()
      where i.sku = p_sku;

    return query
    select
      i.sku,
      i.on_hand,
      i.preorders_remaining,
      i.units_sold,
      i.expected_restock_date,
      case when i.on_hand > 0 then 'In Stock' else 'Out of Stock' end as status
    from inventory i
    where i.sku = p_sku;
  end if;

  v_applied_to_preorders := least(greatest(p_restock, 0), v_existing_preorders);
  v_remaining := greatest(p_restock - v_applied_to_preorders, 0);
  v_queue_to_fulfill := v_applied_to_preorders;
  v_fulfilled := v_applied_to_preorders;

  for v_queue in
    select pq.id, pq.order_id, pq.remaining
    from preorder_queue pq
    where pq.sku = p_sku and pq.remaining > 0
    order by pq.created_at, pq.id
    for update
  loop
    exit when v_queue_to_fulfill <= 0;

    if v_queue.remaining <= v_queue_to_fulfill then
      v_release_qty := v_queue.remaining;
      update preorder_queue pq
        set remaining = 0,
            fulfilled_at = now()
        where pq.id = v_queue.id;
      v_queue_to_fulfill := v_queue_to_fulfill - v_release_qty;
    else
      v_release_qty := v_queue_to_fulfill;
      update preorder_queue pq
        set remaining = pq.remaining - v_release_qty
        where pq.id = v_queue.id;
      v_queue_to_fulfill := 0;
    end if;

    if v_release_qty > 0 then
      insert into preorder_release_events (
        preorder_queue_id,
        order_id,
        sku,
        quantity
      ) values (
        v_queue.id,
        v_queue.order_id,
        p_sku,
        v_release_qty
      );
    end if;
  end loop;

  update inventory i
    set preorders_remaining = greatest(v_existing_preorders - v_fulfilled, 0),
        on_hand = i.on_hand + v_remaining,
        expected_restock_date = case
          when (i.on_hand + v_remaining) > 0 then null
          else i.expected_restock_date
        end,
        updated_at = now()
    where i.sku = p_sku;

  return query
  select
    i.sku,
    i.on_hand,
    i.preorders_remaining,
    i.units_sold,
    i.expected_restock_date,
    case when i.on_hand > 0 then 'In Stock' else 'Out of Stock' end as status
  from inventory i
  where i.sku = p_sku;
end;
$$;

create or replace function set_expected_restock_date(
  p_sku text,
  p_date date
) returns table (
  sku text,
  on_hand integer,
  preorders_remaining integer,
  units_sold integer,
  expected_restock_date date,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update inventory i
    set expected_restock_date = p_date,
        updated_at = now()
    where i.sku = p_sku;

  if not found then
    raise exception 'Unknown SKU: %', p_sku;
  end if;

  return query
  select
    i.sku,
    i.on_hand,
    i.preorders_remaining,
    i.units_sold,
    i.expected_restock_date,
    case when i.on_hand > 0 then 'In Stock' else 'Out of Stock' end as status
  from inventory i
  where i.sku = p_sku;
end;
$$;

create or replace function get_preorder_ready_email_candidate_orders(
  p_cutoff timestamptz,
  p_stale_before timestamptz,
  p_limit integer default 4,
  p_max_events_per_order integer default 200
) returns table(order_id uuid, event_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    pre.order_id,
    count(*)::integer as event_count
  from preorder_release_events pre
  join orders o on o.id = pre.order_id
  where o.status = 'paid'
    and pre.ready_pickup_email_sent_at is null
  group by pre.order_id
  having max(pre.created_at) <= p_cutoff
    and count(*) <= least(greatest(coalesce(p_max_events_per_order, 200), 1), 1000)
    and bool_and(
      pre.ready_pickup_email_claim_token is null
      or pre.ready_pickup_email_claimed_at is null
      or pre.ready_pickup_email_claimed_at <= p_stale_before
    )
  order by min(pre.created_at), pre.order_id
  limit least(greatest(coalesce(p_limit, 4), 1), 25);
$$;

create or replace function get_preorder_ready_email_backlog_health(
  p_cutoff timestamptz,
  p_max_events_per_order integer default 200
) returns table(poisoned_order_count bigint, poisoned_event_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with oversized as (
    select count(*)::bigint as event_count
    from preorder_release_events pre
    join orders o on o.id = pre.order_id
    where o.status = 'paid'
      and pre.ready_pickup_email_sent_at is null
    group by pre.order_id
    having min(pre.created_at) <= p_cutoff
      and count(*) > least(greatest(coalesce(p_max_events_per_order, 200), 1), 1000)
  )
  select
    count(*)::bigint as poisoned_order_count,
    coalesce(sum(oversized.event_count), 0)::bigint as poisoned_event_count
  from oversized;
$$;

create or replace view inventory_snapshot as
select
  sku,
  on_hand,
  preorders_remaining,
  units_sold,
  expected_restock_date,
  case when on_hand > 0 then 'In Stock' else 'Out of Stock' end as status
from inventory;

-- Lock down direct Data API access. This app talks to Supabase from trusted
-- server routes using the service role key, so public and authenticated roles
-- should not have direct table or RPC access.
do $$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array[
    'products',
    'inventory',
    'site_settings',
    'orders',
    'shipments',
    'shipment_quotes',
    'checkout_shipping_quotes',
    'shipment_parcels',
    'email_signups',
    'do_not_market',
    'analytics_events',
    'email_jobs',
    'order_items',
    'preorder_queue',
    'preorder_release_events',
    'restock_events',
    'api_rate_limits'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);

    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy, v_table);
    end loop;
  end loop;
end $$;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.consume_api_rate_limit(text,text,integer,integer)',
    'public.record_paid_order(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb)',
    'public.record_paid_order(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb,boolean)',
    'public.record_stripe_order_state(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb,boolean,text,timestamptz,timestamptz,boolean)',
    'public.transition_stripe_order_state(uuid,text,timestamptz)',
    'public.transition_stripe_order_state(uuid,text,timestamptz,boolean)',
    'public.transition_stripe_order_state(uuid,text,timestamptz,boolean,timestamptz)',
    'public.sync_shipment_for_order(uuid)',
    'public.sync_all_shipments()',
    'public.get_admin_prep_data(date,timestamptz,timestamptz)',
    'public.apply_restock(text,integer)',
    'public.set_expected_restock_date(text,date)',
    'public.get_non_test_units_sold()',
    'public.unsubscribe_email_addresses(text[],text,text)',
    'public.subscribe_email_address(text,text,text,text)',
    'public.apply_email_list_changes(text[],text[])',
    'public.enqueue_order_confirmation_email(uuid,jsonb,uuid,text)',
    'public.claim_email_job(uuid,timestamptz,uuid)',
    'public.reschedule_or_fail_email_job(uuid,uuid,text,text,boolean,timestamptz)',
    'public.complete_email_job(uuid,uuid,timestamptz)',
    'public.retry_failed_email_job(uuid,timestamptz)',
    'public.claim_preorder_ready_email_events(uuid,uuid[],uuid,timestamptz,timestamptz)',
    'public.release_preorder_ready_email_events(uuid[],uuid)',
    'public.complete_preorder_ready_email_events(uuid[],uuid,timestamptz)',
    'public.get_preorder_ready_email_candidate_orders(timestamptz,timestamptz,integer,integer)',
    'public.get_preorder_ready_email_backlog_health(timestamptz,integer)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end if;
  end loop;
end $$;

insert into products (
  sku,
  slug,
  name,
  profile,
  description,
  specs,
  image_url,
  price_cents,
  product_type,
  size_oz,
  sort_order,
  active
) values
  (
    'VV1',
    'red-coral',
    'Red Coral',
    '',
    'Beyond the benefits of naturally fermented kraut rich in live probiotics that support digestion and gut balance, this blend features beets and carrots, adding antioxidants and key nutrients that support circulation and overall vitality.',
    array[
      'Ingredients: cabbage, beets, carrots, salt',
      'Naturally rich in live probiotics',
      'Supports circulation and overall vitality',
      'Jar size: 12oz'
    ],
    '/product-photos/Red-Coral.webp',
    1199,
    'sauerkraut',
    12,
    1,
    true
  ),
  (
    'VV2',
    'sunset',
    'Sunset',
    '',
    'Beyond the benefits of naturally fermented kraut rich in live probiotics that support digestion and gut balance, this blend is infused with turmeric and cumin seeds, two anti-inflammatory spices known to support digestion and overall wellness.',
    array[
      'Ingredients: cabbage, carrots, turmeric, cumin seeds, salt',
      'Live probiotics for digestion and gut balance',
      'Turmeric and cumin support overall wellness',
      'Jar size: 12oz'
    ],
    '/product-photos/Sunset.webp',
    1199,
    'sauerkraut',
    12,
    2,
    true
  ),
  (
    'VV3',
    'caribbean-heat',
    'Caribbean Heat',
    'Mild Spice',
    'Beyond the benefits of naturally fermented sauerkraut rich in live probiotics that support digestion and gut balance, this mild-spice blend of cabbage and jalapeno delivers a vibrant kick. Jalapenos provide natural antioxidants and vitamin C, making this kraut a flavorful addition to sandwiches and wraps.',
    array[
      'Ingredients: cabbage, jalapeno pepper, salt',
      'Medium heat with a vibrant kick',
      'Vitamin C and antioxidant support',
      'Jar size: 12oz'
    ],
    '/product-photos/Caribbean-Heat.webp',
    1199,
    'sauerkraut',
    12,
    3,
    true
  ),
  (
    'VV4',
    'endless-summer',
    'Endless Summer',
    'Fresh + Balanced',
    'Beyond the benefits of naturally fermented sauerkraut rich in live probiotics that support digestion and gut balance, this blend combines cabbage and carrots, delivering a fresh, well-rounded flavor and natural nutrients that support eye health and overall vitality.',
    array[
      'Ingredients: cabbage, carrots, salt',
      'Live probiotics for digestion and gut balance',
      'Nutrients that support eye health and vitality',
      'Jar size: 12oz'
    ],
    '/product-photos/Endless-Summer.webp',
    1199,
    'sauerkraut',
    12,
    4,
    true
  ),
  (
    'VV5',
    'green-kick',
    'Green Kick Hot Sauce',
    'Mild + Herbal',
    'A raw, fermented hot sauce crafted to preserve live probiotics and bold flavor. With a fresh, herbal profile and mild heat, it is a vibrant addition to scrambled eggs, tacos, wraps, and more. Naturally rich in probiotics, Green Kick delivers flavor and gut-supporting benefits in every spoonful.',
    array[
      'Ingredients: jalapeno pepper, onion, green onion, cilantro',
      'Raw fermented hot sauce with live probiotics',
      'Flavor profile: fresh, herbal, mild heat',
      'Bottle size: 5oz'
    ],
    '/product-photos/Green-Kick.webp',
    999,
    'hot_sauce',
    5,
    5,
    true
  ),
  (
    'VV6',
    'hell-yeah',
    'Hell Yeah! Hot Sauce',
    'Hot + Bright',
    'Crafted for those who crave more heat without sacrificing balance, this raw, fermented hot sauce delivers an intense yet well-rounded spice. Beyond the gut-supporting benefits of live probiotics, it brings bold flavor and satisfying heat in just the right measure, perfect for elevating everyday meals.',
    array[
      'Ingredients: red habanero pepper, red jalapeno pepper, onion',
      'Raw fermented hot sauce with live probiotics',
      'Flavor profile: bold heat with bright finish',
      'Bottle size: 5oz'
    ],
    '/product-photos/Hell-Yeah.webp',
    999,
    'hot_sauce',
    5,
    6,
    true
  )
on conflict (sku) do update set
  slug = excluded.slug,
  name = excluded.name,
  profile = excluded.profile,
  description = excluded.description,
  specs = excluded.specs,
  image_url = excluded.image_url,
  price_cents = excluded.price_cents,
  product_type = excluded.product_type,
  size_oz = excluded.size_oz,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into inventory (sku, on_hand, preorders_remaining, units_sold)
select sku, 0, 0, 0 from products
on conflict (sku) do nothing;

insert into site_settings (id, show_stock)
values (true, true)
on conflict (id) do nothing;

commit;
