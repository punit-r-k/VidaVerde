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

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  stripe_payment_intent text,
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
  restock_qty integer not null check (restock_qty >= 0),
  created_at timestamptz not null default now()
);

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

create or replace function record_paid_order(
  p_session_id text,
  p_payment_intent text,
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
  where stripe_session_id = p_session_id;

  if v_order_id is not null then
    return v_order_id;
  end if;

  insert into orders (
    stripe_session_id,
    stripe_payment_intent,
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
    nullif(p_payment_intent, ''),
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
  v_row record;
begin
  if p_restock < 0 then
    raise exception 'restock must be >= 0';
  end if;

  select * into v_row
  from inventory
  where sku = p_sku
  for update;

  if not found then
    raise exception 'Unknown SKU: %', p_sku;
  end if;

  if p_restock > 0 then
    insert into restock_events (sku, restock_qty)
      values (p_sku, p_restock);
  end if;

  v_remaining := p_restock;

  for v_row in
    select id, remaining
    from preorder_queue
    where sku = p_sku and remaining > 0
    order by created_at, id
    for update
  loop
    exit when v_remaining <= 0;

    if v_row.remaining <= v_remaining then
      update preorder_queue
        set remaining = 0,
            fulfilled_at = now()
        where id = v_row.id;
      v_remaining := v_remaining - v_row.remaining;
      v_fulfilled := v_fulfilled + v_row.remaining;
    else
      update preorder_queue
        set remaining = remaining - v_remaining
        where id = v_row.id;
      v_fulfilled := v_fulfilled + v_remaining;
      v_remaining := 0;
    end if;
  end loop;

  if v_fulfilled > 0 then
    update inventory
      set preorders_remaining = greatest(preorders_remaining - v_fulfilled, 0)
      where sku = p_sku;
  end if;

  if v_remaining > 0 then
    update inventory
      set on_hand = on_hand + v_remaining
      where sku = p_sku;
  end if;

  update inventory set updated_at = now() where sku = p_sku;

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
  update inventory
    set expected_restock_date = p_date,
        updated_at = now()
    where sku = p_sku;

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
    'Crisp + Mineral',
    'White cabbage fermented slowly with alpine salt for clean acidity.',
    array[
      'Ferment: 28 days',
      'Ingredients: white cabbage, alpine salt',
      'Microgreen infusion: broccoli sprouts',
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
    'Warm + Hearthy',
    'Turmeric and cumin seed add warm spice to a crisp cabbage and carrot kraut.',
    array[
      'Ferment: 21 days',
      'Ingredients: organic cabbage, carrots, turmeric, cumin seeds, sea salt',
      'Microgreen infusion: basil shoots',
      'Pairing: seafood + salads',
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
    'caribean-heat',
    'Caribean Heat',
    'Green + Silky',
    'A garden-forward blend with parsley, coriander, and celery leaf.',
    array[
      'Ferment: 18 days',
      'Ingredients: parsley, coriander, celery',
      'Microgreen infusion: pea tendrils',
      'Texture: silk + crunch',
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
    'Deep + Warming',
    'Ancho chili and cacao husk deliver a smoky, velvety finish.',
    array[
      'Ferment: 35 days',
      'Ingredients: ancho, cacao husk, agave',
      'Heat level: 6/10',
      'Pairing: roasted vegetables',
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
    'tropical-wave',
    'Tropical Wave',
    'Warm + Vibrant',
    'Turmeric, ginger, and carrot bring glow and gentle spice.',
    array[
      'Ferment: 24 days',
      'Ingredients: turmeric, ginger, carrot',
      'Microgreen infusion: sunflower greens',
      'Finish: bright + earthy',
      'Jar size: 12oz'
    ],
    'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?auto=format&fit=crop&w=800&q=80',
    1199,
    12,
    5,
    true
  ),
  (
    'VV6',
    'sourkreut-6',
    'Sourkreut 6',
    'Lush + Botanical',
    'Red cabbage and beetroot for a lush, antioxidant-rich kraut.',
    array[
      'Ferment: 26 days',
      'Ingredients: beetroot, red cabbage',
      'Microgreen infusion: radish greens',
      'Color: deep violet',
      'Jar size: 12oz'
    ],
    'https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=800&q=80',
    1199,
    12,
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

commit;
