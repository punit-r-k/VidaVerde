-- Vida Verde Supabase schema
-- Run in the Supabase SQL editor to recreate tables, functions, and seed data.

begin;

create extension if not exists "pgcrypto";

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
  status text not null default 'paid',
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
  currency text not null default 'usd',
  amount_subtotal integer not null default 0,
  amount_tax integer not null default 0,
  amount_shipping integer not null default 0,
  amount_total integer not null default 0,
  customer_confirmation_email_sent_at timestamptz,
  customer_confirmation_email_claimed_at timestamptz,
  pickup_reminder_email_sent_at timestamptz,
  pickup_date date,
  created_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  payment_session_id text not null unique,
  payment_reference text,
  status text not null default 'pending_label'
    check (status in ('pending_label', 'label_purchased', 'shipped', 'delivered', 'cancelled')),
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
  notes text,
  label_purchased_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'website',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

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
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_signups_email_idx on email_signups (email);
create index if not exists email_signups_created_at_idx on email_signups (created_at desc);
create index if not exists analytics_events_created_at_idx on analytics_events (created_at desc);
create index if not exists analytics_events_event_created_at_idx on analytics_events (event_name, created_at desc);
create index if not exists analytics_events_page_created_at_idx on analytics_events (page_path, created_at desc);
create index if not exists analytics_events_section_created_at_idx on analytics_events (section_id, created_at desc);
create index if not exists analytics_events_product_created_at_idx on analytics_events (product_sku, created_at desc);
create index if not exists analytics_events_session_created_at_idx on analytics_events (session_id, created_at desc);
create index if not exists shipments_status_created_at_idx on shipments (status, created_at desc);
create index if not exists shipments_created_at_idx on shipments (created_at desc);
create index if not exists orders_status_created_fulfillment_idx
  on orders (status, created_at desc, fulfillment);
create index if not exists email_jobs_status_available_idx
  on email_jobs (status, available_at, created_at);
create index if not exists email_jobs_order_type_idx
  on email_jobs (order_id, type);
create unique index if not exists email_jobs_order_confirmation_active_idx
  on email_jobs (order_id, type)
  where type = 'order_confirmation'
    and status in ('pending', 'processing', 'failed');

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
end $$;

create index if not exists orders_pickup_date_status_idx
  on orders (pickup_date, status)
  where pickup_date is not null;

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null references products(sku) on update cascade,
  quantity integer not null check (quantity > 0),
  price_cents integer not null check (price_cents >= 0),
  preorder_qty integer not null default 0 check (preorder_qty >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items (order_id);

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
  pickup_reminder_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists preorder_release_events_sku_created_at_idx
  on preorder_release_events (sku, created_at desc, id);
create index if not exists preorder_release_events_order_created_at_idx
  on preorder_release_events (order_id, created_at desc, id);

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
    null,
    v_order_created_at
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
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
    where o.id = p_order_id;

  if not found then
    raise exception 'Unknown order id: %', p_order_id;
  end if;

  if v_order.fulfillment <> 'ship' then
    delete from shipments s
      where s.order_id = v_order.id;
    return null;
  end if;

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
    currency
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
    upper(coalesce(v_order.currency, 'USD'))
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
    updated_at = now()
  returning id into v_shipment_id;

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
  v_synced integer := 0;
begin
  for v_order_id in
    select o.id
    from orders o
    where o.fulfillment = 'ship'
      and o.status = 'paid'
    order by o.created_at desc
  loop
    perform sync_shipment_for_order(v_order_id);
    v_synced := v_synced + 1;
  end loop;

  return v_synced;
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
      and pre.created_at >= p_collection_start_at
      and pre.created_at < p_collection_end_at
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
      pre.created_at,
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
      and pre.created_at >= p_collection_start_at
      and pre.created_at < p_collection_end_at
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
    'email_signups',
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

revoke execute on function consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function record_paid_order(text, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function sync_shipment_for_order(uuid) from public, anon, authenticated;
revoke execute on function sync_all_shipments() from public, anon, authenticated;
revoke execute on function get_admin_prep_data(date, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function apply_restock(text, integer) from public, anon, authenticated;
revoke execute on function set_expected_restock_date(text, date) from public, anon, authenticated;

grant execute on function consume_api_rate_limit(text, text, integer, integer) to service_role;
grant execute on function record_paid_order(text, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb) to service_role;
grant execute on function sync_shipment_for_order(uuid) to service_role;
grant execute on function sync_all_shipments() to service_role;
grant execute on function get_admin_prep_data(date, timestamptz, timestamptz) to service_role;
grant execute on function apply_restock(text, integer) to service_role;
grant execute on function set_expected_restock_date(text, date) to service_role;

insert into products (
  sku,
  slug,
  name,
  profile,
  description,
  specs,
  image_url,
  price_cents,
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
    'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80',
    1199,
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
    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=800&q=80',
    1199,
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
    'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?auto=format&fit=crop&w=800&q=80',
    999,
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
    'https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=800&q=80',
    999,
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
