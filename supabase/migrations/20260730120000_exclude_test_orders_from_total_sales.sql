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
