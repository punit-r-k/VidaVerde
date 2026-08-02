begin;

-- Finalization and the Stripe webhook can process the same PaymentIntent at
-- the same time. Serialize by payment session before checking for an existing
-- order, and acquire inventory locks in SKU order for overlapping carts.
create or replace function public.record_paid_order(
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
  if nullif(trim(coalesce(p_session_id, '')), '') is null then
    raise exception 'A payment session id is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

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

  for v_item in
    select item.value
    from jsonb_array_elements(p_items) as item(value)
    order by trim(both from coalesce(item.value->>'sku', ''))
  loop
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

revoke all on function public.record_paid_order(
  text, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.record_paid_order(
  text, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb
) to service_role;

commit;
