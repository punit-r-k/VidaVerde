begin;

-- Financial test orders belong in operations reporting, but never in the
-- postage workflow. Create a permanently cancelled shipment summary so the
-- Shipments sheet can show the order without making it eligible for a label.
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
    hot_sauce_count,
    label_purchase_error
  )
  select
    o.id,
    o.payment_session_id,
    o.payment_reference,
    'cancelled',
    coalesce(o.customer_name, ''),
    coalesce(o.customer_email, ''),
    nullif(o.customer_phone, ''),
    coalesce(o.address1, ''),
    nullif(o.address2, ''),
    coalesce(o.city, ''),
    coalesce(o.state, ''),
    coalesce(o.postal_code, ''),
    'US',
    item_summary.items_summary,
    item_summary.items_json,
    item_summary.item_count,
    coalesce(o.amount_total, 0),
    upper(coalesce(o.currency, 'USD')),
    nullif(o.shipping_tier, ''),
    nullif(o.shipping_option, ''),
    nullif(o.shipping_option_label, ''),
    nullif(o.shipping_estimate, ''),
    coalesce(o.sauerkraut_count, 0),
    coalesce(o.hot_sauce_count, 0),
    'Financial test order — visible for reporting only; label purchase and tracking are disabled.'
  from orders o
  cross join lateral (
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
      ) as items_json,
      coalesce(
        string_agg(
          format('%s x%s', coalesce(p.name, oi.sku), oi.quantity),
          ', '
          order by oi.created_at, oi.id
        ),
        ''
      ) as items_summary,
      coalesce(sum(oi.quantity), 0)::integer as item_count
    from order_items oi
    left join products p on p.sku = oi.sku
    where oi.order_id = o.id
  ) item_summary
  where o.fulfillment = 'ship'
    and o.status = 'paid'
    and coalesce(o.is_test_order, false)
    and item_summary.item_count > 0
    and not exists (
      select 1
      from shipments s
      where s.order_id = o.id
    )
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

revoke all on function sync_all_shipments()
  from public, anon, authenticated;
grant execute on function sync_all_shipments()
  to service_role;

commit;
