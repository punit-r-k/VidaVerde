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

update products
  set product_type = case
    when sku in ('VV5', 'VV6') then 'hot_sauce'
    else 'sauerkraut'
  end
  where sku in ('VV1', 'VV2', 'VV3', 'VV4', 'VV5', 'VV6');

alter table orders add column if not exists shipping_tier text;
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
  returning id into v_shipment_id;

  return v_shipment_id;
end;
$$;
