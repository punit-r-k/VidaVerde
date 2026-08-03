begin;

-- Keep this safety migration deployable when production migration history is
-- incomplete. These columns were first introduced by
-- 20260731160000_automatic_fastest_shipping_labels.sql, but older databases
-- may not have recorded or applied that migration yet.
alter table shipments
  add column if not exists label_purchase_started_at timestamptz,
  add column if not exists label_purchase_error text;

alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('paid', 'pending', 'cancelled', 'refunded', 'disputed', 'fulfilled')) not valid;

alter table orders drop constraint if exists orders_currency_usd;
alter table orders add constraint orders_currency_usd
  check (lower(currency) = 'usd') not valid;

alter table orders drop constraint if exists orders_amounts_nonnegative;
alter table orders add constraint orders_amounts_nonnegative
  check (
    amount_subtotal >= 0 and
    amount_tax >= 0 and
    amount_shipping >= 0 and
    amount_total >= 0
  ) not valid;

alter table orders drop constraint if exists orders_total_matches_components;
alter table orders add constraint orders_total_matches_components
  check (amount_total = amount_subtotal + amount_tax + amount_shipping) not valid;

alter table orders drop constraint if exists orders_market_has_no_shipping_charge;
alter table orders add constraint orders_market_has_no_shipping_charge
  check (fulfillment <> 'market' or amount_shipping = 0) not valid;

alter table order_items drop constraint if exists order_items_preorder_not_above_quantity;
alter table order_items add constraint order_items_preorder_not_above_quantity
  check (preorder_qty <= quantity) not valid;

-- These constraints were introduced as NOT VALID so PostgreSQL could install
-- them without taking a long validation lock. Validate them in this release so
-- historical bad data cannot remain hidden indefinitely.
alter table orders validate constraint orders_status_check;
alter table orders validate constraint orders_currency_usd;
alter table orders validate constraint orders_amounts_nonnegative;
alter table orders validate constraint orders_total_matches_components;
alter table orders validate constraint orders_market_has_no_shipping_charge;
alter table order_items validate constraint order_items_preorder_not_above_quantity;

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

  -- Financial test orders exercise the payment ledger only. They must never
  -- create or reactivate postage. Cancel only work for which no purchased
  -- artifact exists; bought labels and parcel records remain untouched for the
  -- audit trail.
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

  -- A dispute is reversible. Release an in-flight claim but retain pending
  -- shipment work so a won dispute can resume without rebuilding reservations.
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

  -- Never buy a new label for a non-shipping or no-longer-paid order. Preserve
  -- labels that were already bought so operators retain a complete audit trail.
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

  -- Preorders must not create or purchase postage until every queued unit for
  -- this order is ready. A stale unpurchased row from older code is removable;
  -- purchased rows are deliberately retained.
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

  -- A previously paused partial purchase becomes eligible as soon as the last
  -- preorder unit is released. Clearing the marker lets the label worker resume
  -- its idempotent EasyPost recovery path.
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

  -- A reversible operational hold can leave an unpurchased row cancelled.
  -- Once the paid order is eligible again, reuse that row instead of letting
  -- it permanently block shipment preparation.
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
begin
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

-- One-time cleanup for financial test rows created by older synchronization
-- code. The purchase-evidence predicates deliberately preserve bought labels.
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

revoke all on function sync_shipment_for_order(uuid)
  from public, anon, authenticated;
grant execute on function sync_shipment_for_order(uuid)
  to service_role;

revoke all on function sync_all_shipments()
  from public, anon, authenticated;
grant execute on function sync_all_shipments()
  to service_role;

commit;
