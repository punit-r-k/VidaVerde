begin;

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

grant execute on function get_admin_prep_data(date, timestamptz, timestamptz) to service_role;

commit;

