begin;

-- This RPC is intentionally separate from the production-safe shipment RPC.
-- The application calls it only while authenticated with an EasyPost test key.
create or replace function public.sync_shipment_for_order_with_test_labels(
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

  if not coalesce(v_order.is_test_order, false) then
    return public.sync_shipment_for_order(p_order_id);
  end if;

  if v_order.fulfillment <> 'ship' or v_order.status <> 'paid' then
    return null;
  end if;

  if exists (
    select 1
    from preorder_queue pq
    where pq.order_id = v_order.id
      and pq.remaining > 0
  ) then
    return null;
  end if;

  select s.id
    into v_shipment_id
    from shipments s
    where s.order_id = v_order.id
      and (
        s.status in ('purchasing_label', 'label_purchased', 'shipped', 'delivered')
        or s.label_purchased_at is not null
        or nullif(trim(coalesce(s.label_url, '')), '') is not null
        or nullif(trim(coalesce(s.tracking_number, '')), '') is not null
        or exists (
          select 1
          from shipment_parcels sp
          where sp.shipment_id = s.id
            and sp.status in ('label_purchased', 'shipped', 'delivered')
        )
      );

  if v_shipment_id is not null then
    return v_shipment_id;
  end if;

  update shipments s
    set status = 'pending_label',
        label_purchase_started_at = null,
        label_purchase_error = null,
        updated_at = clock_timestamp()
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
    order_id, payment_session_id, payment_reference, status,
    customer_name, customer_email, customer_phone,
    address1, address2, city, state, postal_code, country,
    items_summary, items_json, item_count, amount_total, currency,
    shipping_tier, shipping_option, shipping_option_label, shipping_estimate,
    sauerkraut_count, hot_sauce_count, label_purchase_error
  ) values (
    v_order.id, v_order.payment_session_id, v_order.payment_reference,
    'pending_label', coalesce(v_order.customer_name, ''),
    coalesce(v_order.customer_email, ''), nullif(v_order.customer_phone, ''),
    coalesce(v_order.address1, ''), nullif(v_order.address2, ''),
    coalesce(v_order.city, ''), coalesce(v_order.state, ''),
    coalesce(v_order.postal_code, ''), 'US', v_items_summary, v_items_json,
    v_item_count, coalesce(v_order.amount_total, 0),
    upper(coalesce(v_order.currency, 'USD')), nullif(v_order.shipping_tier, ''),
    nullif(v_order.shipping_option, ''), nullif(v_order.shipping_option_label, ''),
    nullif(v_order.shipping_estimate, ''), coalesce(v_order.sauerkraut_count, 0),
    coalesce(v_order.hot_sauce_count, 0), null
  )
  on conflict (order_id) do update set
    status = case
      when shipments.status = 'cancelled'
        and shipments.label_purchased_at is null
        and nullif(trim(coalesce(shipments.label_url, '')), '') is null
        and nullif(trim(coalesce(shipments.tracking_number, '')), '') is null
      then 'pending_label'
      else shipments.status
    end,
    label_purchase_started_at = null,
    label_purchase_error = null,
    items_summary = excluded.items_summary,
    items_json = excluded.items_json,
    item_count = excluded.item_count,
    updated_at = clock_timestamp()
  returning id into v_shipment_id;

  return v_shipment_id;
end;
$$;

create or replace function public.sync_test_shipments_for_labels()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_shipment_id uuid;
  v_synced integer := 0;
begin
  for v_order_id in
    select o.id
    from orders o
    where o.fulfillment = 'ship'
      and o.status = 'paid'
      and coalesce(o.is_test_order, false)
      and not exists (
        select 1 from preorder_queue pq
        where pq.order_id = o.id and pq.remaining > 0
      )
      and (
        not exists (select 1 from shipments s where s.order_id = o.id)
        or exists (
          select 1 from shipments s
          where s.order_id = o.id
            and s.status = 'cancelled'
            and s.label_purchased_at is null
            and nullif(trim(coalesce(s.label_url, '')), '') is null
            and nullif(trim(coalesce(s.tracking_number, '')), '') is null
        )
      )
    order by o.created_at desc, o.id
    limit 100
  loop
    v_shipment_id := public.sync_shipment_for_order_with_test_labels(v_order_id);
    if v_shipment_id is not null then
      v_synced := v_synced + 1;
    end if;
  end loop;
  return v_synced;
end;
$$;

revoke all on function public.sync_shipment_for_order_with_test_labels(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_shipment_for_order_with_test_labels(uuid)
  to service_role;

revoke all on function public.sync_test_shipments_for_labels()
  from public, anon, authenticated;
grant execute on function public.sync_test_shipments_for_labels()
  to service_role;

commit;
