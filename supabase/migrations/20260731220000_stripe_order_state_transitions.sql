begin;

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

  -- A refund remains the terminal financial state if dispute webhooks arrive
  -- late or out of order.
  if v_current_status = 'refunded' and v_target_status in ('paid', 'disputed') then
    v_target_status := v_current_status;
  end if;

  -- A successful dispute outcome can restore only an order that was paused by
  -- a dispute. Replays against an already-paid order are intentionally safe.
  if v_target_status = 'paid' and v_current_status not in ('paid', 'disputed') then
    raise exception 'Cannot restore order % to paid from status %', p_order_id, v_current_status;
  end if;

  -- PaymentIntent cancellation is a pre-payment event. Never allow it to
  -- regress an order that was already recorded as paid or fulfilled.
  if v_target_status = 'cancelled' and v_current_status not in ('pending', 'cancelled') then
    raise exception 'Cannot cancel order % from status %', p_order_id, v_current_status;
  end if;

  update orders
    set status = v_target_status
    where id = p_order_id
      and status <> v_target_status;

  -- An active dispute is a reversible fulfillment pause. Keep its outstanding
  -- preorder allocation, checkout quote, and unpurchased shipment intact so a
  -- later win can resume without reconstructing operational state.
  if not coalesce(p_retire_work, true)
     or v_target_status not in ('cancelled', 'refunded', 'disputed') then
    return v_target_status;
  end if;

  -- Follow the same inventory -> queue lock order used by restock processing,
  -- then retire only preorder units that are still outstanding.
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

  -- A shipment can be cancelled automatically only while no label or parcel
  -- purchase has been recorded. Purchased artifacts remain for operator audit.
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

revoke all on function transition_stripe_order_state(uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function transition_stripe_order_state(uuid, text, timestamptz, boolean)
  to service_role;

commit;
