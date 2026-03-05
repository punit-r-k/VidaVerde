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

create index if not exists email_signups_email_idx on email_signups (email);
create index if not exists email_signups_created_at_idx on email_signups (created_at desc);
create index if not exists shipments_status_created_at_idx on shipments (status, created_at desc);
create index if not exists shipments_created_at_idx on shipments (created_at desc);

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
end $$;

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null references products(sku) on update cascade,
  quantity integer not null check (quantity > 0),
  price_cents integer not null check (price_cents >= 0),
  preorder_qty integer not null default 0 check (preorder_qty >= 0),
  created_at timestamptz not null default now()
);

create table if not exists preorder_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null references products(sku) on update cascade,
  quantity integer not null check (quantity > 0),
  remaining integer not null check (remaining >= 0 and remaining <= quantity),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create index if not exists preorder_queue_sku_idx on preorder_queue (sku, created_at, id);

create table if not exists restock_events (
  id uuid primary key default gen_random_uuid(),
  sku text not null references products(sku) on update cascade,
  restock_qty integer not null,
  created_at timestamptz not null default now()
);

alter table restock_events drop constraint if exists restock_events_restock_qty_check;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

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
    amount_total
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
    coalesce(p_amount_total, 0)
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

    update inventory
      set on_hand = case when on_hand >= v_qty then on_hand - v_qty else 0 end,
          units_sold = units_sold + v_qty,
          preorders_remaining = preorders_remaining + v_preorder,
          updated_at = now()
      where sku = v_sku;

    insert into order_items (order_id, sku, quantity, price_cents, preorder_qty)
      values (v_order_id, v_sku, v_qty, v_price, v_preorder);

    if v_preorder > 0 then
      insert into preorder_queue (order_id, sku, quantity, remaining)
        values (v_order_id, v_sku, v_preorder, v_preorder);
    end if;
  end loop;

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
    select pq.id, pq.remaining
    from preorder_queue pq
    where pq.sku = p_sku and pq.remaining > 0
    order by pq.created_at, pq.id
    for update
  loop
    exit when v_queue_to_fulfill <= 0;

    if v_queue.remaining <= v_queue_to_fulfill then
      update preorder_queue pq
        set remaining = 0,
            fulfilled_at = now()
        where pq.id = v_queue.id;
      v_queue_to_fulfill := v_queue_to_fulfill - v_queue.remaining;
    else
      update preorder_queue pq
        set remaining = pq.remaining - v_queue_to_fulfill
        where pq.id = v_queue.id;
      v_queue_to_fulfill := 0;
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
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80',
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
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80',
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
    1199,
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
    1199,
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
