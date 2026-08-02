begin;

alter table public.orders
  add column if not exists stripe_state_effective_at timestamptz,
  add column if not exists stripe_state_observed_at timestamptz,
  add column if not exists stripe_state_retire_work boolean not null default false,
  add column if not exists stripe_fulfillment_retired_at timestamptz;

update public.orders
set stripe_state_effective_at = coalesce(
      stripe_state_effective_at,
      '-infinity'::timestamptz
    ),
    stripe_state_observed_at = coalesce(
      stripe_state_observed_at,
      '-infinity'::timestamptz
    )
where stripe_state_effective_at is null
   or stripe_state_observed_at is null;

-- Earlier migrations did not persist whether a disputed order had already
-- released inventory/preorder work. Quarantine that ambiguous legacy state;
-- a producer can reconcile and explicitly clear it after verifying inventory.
update public.orders
set stripe_state_retire_work = true,
    stripe_fulfillment_retired_at = coalesce(
      stripe_fulfillment_retired_at,
      created_at
    )
where status in ('refunded', 'disputed')
  and stripe_state_effective_at = '-infinity'::timestamptz;

create or replace function public.guard_retired_stripe_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retired_at timestamptz;
begin
  if new.status not in ('pending_label', 'purchasing_label') then
    return new;
  end if;

  select o.stripe_fulfillment_retired_at
    into v_retired_at
    from public.orders o
    where o.id = new.order_id;

  if v_retired_at is not null then
    new.status := 'cancelled';
    new.label_purchase_started_at := null;
    new.label_purchase_error :=
      'Fulfillment is blocked because the payment state retired its inventory allocation; operator reconciliation is required.';
    new.updated_at := clock_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists shipments_guard_retired_stripe_fulfillment on public.shipments;
create trigger shipments_guard_retired_stripe_fulfillment
before insert or update of status, label_purchase_started_at on public.shipments
for each row execute function public.guard_retired_stripe_fulfillment();

revoke all on function public.guard_retired_stripe_fulfillment()
  from public, anon, authenticated;

-- Re-entering the succeeded path after a safely won dispute must also recover
-- a confirmation job that was failed only because the order was temporarily
-- ineligible. Other terminal failures retain their explicit producer retry.
create or replace function public.enqueue_order_confirmation_email(
  p_order_id uuid,
  p_payload jsonb,
  p_claim_token uuid,
  p_message_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_message_id text := trim(coalesce(p_message_id, ''));
  v_order public.orders%rowtype;
  v_existing public.email_jobs%rowtype;
  v_job_id uuid;
begin
  if p_order_id is null or p_claim_token is null then
    raise exception 'An order id and claim token are required.';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The order confirmation payload must be a JSON object.';
  end if;

  if length(v_message_id) not between 3 and 320
     or v_message_id ~ E'[\\r\\n]' then
    raise exception 'The order confirmation Message-ID is invalid.';
  end if;

  select *
    into v_order
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found
     or v_order.customer_confirmation_email_sent_at is not null
     or v_order.status <> 'paid'
     or v_order.stripe_fulfillment_retired_at is not null then
    return null;
  end if;

  select ej.*
    into v_existing
    from public.email_jobs ej
    where ej.order_id = p_order_id
      and ej.type = 'order_confirmation'
      and ej.status in ('pending', 'processing')
    order by ej.created_at, ej.id
    limit 1
    for update;

  if found then
    update public.orders
      set customer_confirmation_email_claimed_at = v_existing.claimed_at,
          customer_confirmation_email_claim_token = v_existing.claim_token
      where id = p_order_id;
    return v_existing.id;
  end if;

  select ej.*
    into v_existing
    from public.email_jobs ej
    where ej.order_id = p_order_id
      and ej.type = 'order_confirmation'
      and ej.status = 'failed'
    order by ej.processed_at desc nulls last, ej.created_at desc, ej.id desc
    limit 1
    for update;

  if found then
    if v_existing.last_error_code = 'order_ineligible' then
      update public.email_jobs
        set status = 'pending',
            payload = p_payload || jsonb_build_object('orderId', p_order_id::text),
            available_at = v_now,
            processed_at = null,
            claimed_at = v_now,
            claim_token = p_claim_token,
            last_error_code = null,
            last_error = null
        where id = v_existing.id;

      update public.orders
        set customer_confirmation_email_claimed_at = v_now,
            customer_confirmation_email_claim_token = p_claim_token
        where id = p_order_id;
    end if;

    return v_existing.id;
  end if;

  if v_order.customer_confirmation_email_claimed_at is not null
     and v_order.customer_confirmation_email_claimed_at > v_now - interval '30 minutes'
     and v_order.customer_confirmation_email_claim_token is distinct from p_claim_token then
    return null;
  end if;

  insert into public.email_jobs (
    type,
    status,
    order_id,
    payload,
    available_at,
    claimed_at,
    claim_token,
    message_id
  ) values (
    'order_confirmation',
    'pending',
    p_order_id,
    p_payload || jsonb_build_object('orderId', p_order_id::text),
    v_now,
    v_now,
    p_claim_token,
    v_message_id
  )
  returning id into v_job_id;

  update public.orders
    set customer_confirmation_email_claimed_at = v_now,
        customer_confirmation_email_claim_token = p_claim_token
    where id = p_order_id;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_order_confirmation_email(uuid, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_order_confirmation_email(uuid, jsonb, uuid, text)
  to service_role;

create or replace function public.claim_email_job(
  p_job_id uuid,
  p_stale_before timestamptz,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_job public.email_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null or p_stale_before is null then
    return null;
  end if;

  select ej.order_id
    into v_order_id
    from public.email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return null;
  end if;

  select *
    into v_order
    from public.orders o
    where o.id = v_order_id
    for update;

  if not found then
    return null;
  end if;

  select *
    into v_job
    from public.email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.type <> 'order_confirmation'
     or v_job.attempts >= v_job.max_attempts then
    return null;
  end if;

  if v_order.customer_confirmation_email_sent_at is not null then
    update public.email_jobs
      set status = 'sent',
          processed_at = coalesce(processed_at, v_order.customer_confirmation_email_sent_at),
          claim_token = null,
          claimed_at = null,
          last_error_code = null,
          last_error = null
      where id = v_job.id;
    update public.orders
      set customer_confirmation_email_claim_token = null,
          customer_confirmation_email_claimed_at = null
      where id = v_order.id;
    return null;
  end if;

  if v_order.status <> 'paid'
     or v_order.stripe_fulfillment_retired_at is not null then
    update public.email_jobs
      set status = 'failed',
          processed_at = v_now,
          claim_token = null,
          claimed_at = null,
          last_error_code = 'order_ineligible',
          last_error = 'The order is no longer eligible for confirmation delivery.'
      where id = v_job.id;
    update public.orders
      set customer_confirmation_email_claim_token = null,
          customer_confirmation_email_claimed_at = null
      where id = v_order.id;
    return null;
  end if;

  if not (
    (v_job.status = 'pending' and v_job.available_at <= v_now)
    or (
      v_job.status = 'processing'
      and v_job.claimed_at is not null
      and v_job.claimed_at <= p_stale_before
    )
  ) then
    return null;
  end if;

  update public.email_jobs
    set status = 'processing',
        claim_token = p_claim_token,
        claimed_at = v_now,
        processed_at = null,
        last_error_code = null,
        last_error = null
    where id = v_job.id
    returning * into v_job;

  update public.orders
    set customer_confirmation_email_claim_token = p_claim_token,
        customer_confirmation_email_claimed_at = v_now
    where id = v_order.id;

  return jsonb_build_object(
    'id', v_job.id,
    'type', v_job.type,
    'order_id', v_job.order_id,
    'payload', v_job.payload,
    'attempts', v_job.attempts,
    'max_attempts', v_job.max_attempts,
    'message_id', v_job.message_id,
    'claim_token', v_job.claim_token
  );
end;
$$;

revoke all on function public.claim_email_job(uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_email_job(uuid, timestamptz, uuid)
  to service_role;

create or replace function public.retry_failed_email_job(
  p_job_id uuid,
  p_available_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_job public.email_jobs%rowtype;
  v_claim_token uuid := gen_random_uuid();
begin
  if p_job_id is null then
    return false;
  end if;

  select ej.order_id
    into v_order_id
    from public.email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return false;
  end if;

  select *
    into v_order
    from public.orders o
    where o.id = v_order_id
    for update;

  if not found
     or v_order.status <> 'paid'
     or v_order.stripe_fulfillment_retired_at is not null
     or v_order.customer_confirmation_email_sent_at is not null then
    return false;
  end if;

  select *
    into v_job
    from public.email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.type <> 'order_confirmation'
     or v_job.status <> 'failed'
     or exists (
       select 1
       from public.email_jobs active_job
       where active_job.order_id = v_order_id
         and active_job.type = 'order_confirmation'
         and active_job.status in ('pending', 'processing')
         and active_job.id <> v_job.id
     ) then
    return false;
  end if;

  update public.email_jobs
    set status = 'pending',
        attempts = 0,
        available_at = greatest(coalesce(p_available_at, v_now), v_now),
        processed_at = null,
        claimed_at = v_now,
        claim_token = v_claim_token,
        last_error_code = null,
        last_error = null
    where id = v_job.id;

  update public.orders
    set customer_confirmation_email_claimed_at = v_now,
        customer_confirmation_email_claim_token = v_claim_token
    where id = v_order_id;

  return true;
end;
$$;

revoke all on function public.retry_failed_email_job(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.retry_failed_email_job(uuid, timestamptz)
  to service_role;

create or replace function public.transition_stripe_order_state(
  p_order_id uuid,
  p_target_status text,
  p_effective_at timestamptz,
  p_retire_work boolean,
  p_observed_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_current_effective_at timestamptz;
  v_current_observed_at timestamptz;
  v_current_retire_work boolean;
  v_target_status text := lower(trim(coalesce(p_target_status, '')));
  v_effective_at timestamptz := coalesce(p_effective_at, clock_timestamp());
  v_observed_at timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_cancelled_preorders record;
begin
  if v_target_status not in ('paid', 'cancelled', 'refunded', 'disputed') then
    raise exception 'Unsupported Stripe order status transition: %', v_target_status;
  end if;

  select
      o.status,
      o.stripe_state_effective_at,
      o.stripe_state_observed_at,
      o.stripe_state_retire_work
    into
      v_current_status,
      v_current_effective_at,
      v_current_observed_at,
      v_current_retire_work
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Unknown order id: %', p_order_id;
  end if;

  -- A full refund is terminal even if a later dispute notification is replayed.
  if v_current_status = 'refunded' and v_target_status in ('paid', 'disputed') then
    return v_current_status;
  end if;

  -- Event time is the primary ordering key. A response for an older event may
  -- stall and finish later, so its newer observation time must never let it
  -- overwrite a newer financial transition. Observation time breaks ties only
  -- when Stripe emitted events at the same timestamp.
  if v_current_effective_at is not null
     and v_effective_at < v_current_effective_at then
    return v_current_status;
  end if;

  if v_current_effective_at is not null
     and v_effective_at = v_current_effective_at
     and v_current_observed_at is not null
     and v_observed_at < v_current_observed_at then
    return v_current_status;
  end if;

  -- Exact ordering-key ties converge by severity instead of lock acquisition
  -- order: refund > lost dispute > active dispute > paid > cancellation.
  if v_current_effective_at is not null
     and v_effective_at = v_current_effective_at
     and v_current_observed_at is not null
     and v_observed_at = v_current_observed_at
     and (
       case
         when v_target_status = 'refunded' then 50
         when v_target_status = 'disputed' and coalesce(p_retire_work, true) then 40
         when v_target_status = 'disputed' then 30
         when v_target_status = 'paid' then 20
         when v_target_status = 'cancelled' then 10
         else 0
       end
     ) <= (
       case
         when v_current_status = 'refunded' then 50
         when v_current_status = 'disputed' and coalesce(v_current_retire_work, false) then 40
         when v_current_status = 'disputed' then 30
         when v_current_status = 'paid' then 20
         when v_current_status = 'cancelled' then 10
         else 0
       end
     ) then
    return v_current_status;
  end if;

  if v_target_status = 'paid' and v_current_status not in ('paid', 'disputed') then
    raise exception 'Cannot restore order % to paid from status %', p_order_id, v_current_status;
  end if;

  if v_target_status = 'cancelled' and v_current_status not in ('pending', 'cancelled') then
    raise exception 'Cannot cancel order % from status %', p_order_id, v_current_status;
  end if;

  update public.orders
    set status = v_target_status,
        stripe_state_effective_at = v_effective_at,
        stripe_state_observed_at = v_observed_at,
        stripe_state_retire_work = (
          v_target_status = 'disputed' and coalesce(p_retire_work, true)
        ),
        stripe_fulfillment_retired_at = case
          when v_target_status in ('cancelled', 'refunded')
            or (v_target_status = 'disputed' and coalesce(p_retire_work, true))
            then coalesce(stripe_fulfillment_retired_at, v_effective_at)
          else stripe_fulfillment_retired_at
        end
    where id = p_order_id;

  -- Invalidate an in-flight label lease before returning from every payment
  -- hold or terminal transition. This deliberately does not depend on label
  -- or parcel evidence: purchased artifacts remain stored, but a worker that
  -- acquired the old lease may no longer publish its result as eligible.
  if v_target_status = 'disputed' and not coalesce(p_retire_work, true) then
    update public.shipments s
      set status = 'pending_label',
          label_purchase_started_at = null,
          label_purchase_error = 'Label purchase paused because the payment is disputed.',
          updated_at = v_observed_at
      where s.order_id = p_order_id
        and s.status = 'purchasing_label';
  elsif v_target_status in ('cancelled', 'refunded')
        or (v_target_status = 'disputed' and coalesce(p_retire_work, true)) then
    update public.shipments s
      set status = 'cancelled',
          label_purchase_started_at = null,
          label_purchase_error = case
            when v_target_status = 'refunded'
              then 'Label purchase stopped because the payment was fully refunded.'
            when v_target_status = 'disputed'
              then 'Label purchase stopped because the payment dispute was lost.'
            else 'Label purchase stopped because the payment was cancelled.'
          end,
          updated_at = v_observed_at
      where s.order_id = p_order_id
        and s.status = 'purchasing_label';
  end if;

  if not coalesce(p_retire_work, true)
     or v_target_status not in ('cancelled', 'refunded', 'disputed') then
    return v_target_status;
  end if;

  perform i.sku
    from public.inventory i
    where exists (
      select 1
      from public.preorder_queue pq
      where pq.order_id = p_order_id
        and pq.sku = i.sku
        and pq.remaining > 0
    )
    order by i.sku
    for update;

  perform pq.id
    from public.preorder_queue pq
    where pq.order_id = p_order_id
      and pq.remaining > 0
    order by pq.sku, pq.created_at, pq.id
    for update;

  for v_cancelled_preorders in
    select pq.sku, sum(pq.remaining)::integer as quantity
    from public.preorder_queue pq
    where pq.order_id = p_order_id
      and pq.remaining > 0
    group by pq.sku
  loop
    update public.inventory i
      set preorders_remaining = greatest(
            i.preorders_remaining - v_cancelled_preorders.quantity,
            0
          ),
          updated_at = v_effective_at
      where i.sku = v_cancelled_preorders.sku;
  end loop;

  update public.preorder_queue
    set remaining = 0
    where order_id = p_order_id
      and remaining > 0;

  update public.shipments s
    set status = 'cancelled',
        updated_at = v_effective_at
    where s.order_id = p_order_id
      and s.status in ('pending_label', 'purchasing_label')
      and s.label_purchased_at is null
      and nullif(trim(coalesce(s.label_url, '')), '') is null
      and nullif(trim(coalesce(s.tracking_number, '')), '') is null
      and not exists (
        select 1
        from public.shipment_parcels sp
        where sp.shipment_id = s.id
          and sp.status in ('label_purchased', 'shipped', 'delivered')
      );

  update public.checkout_shipping_quotes q
    set status = 'cancelled',
        updated_at = v_effective_at
    from public.orders o
    where o.id = p_order_id
      and q.status = 'quoted'
      and q.payment_session_id in (o.payment_session_id, o.payment_reference);

  return v_target_status;
end;
$$;

-- Preserve the prior server-only signature for a rolling deploy. New callers
-- pass the observation timestamp explicitly through the five-argument form.
create or replace function public.transition_stripe_order_state(
  p_order_id uuid,
  p_target_status text,
  p_effective_at timestamptz default now(),
  p_retire_work boolean default true
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.transition_stripe_order_state(
    p_order_id,
    p_target_status,
    p_effective_at,
    p_retire_work,
    clock_timestamp()
  );
end;
$$;

create or replace function public.record_stripe_order_state(
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
  p_items jsonb,
  p_is_test_order boolean,
  p_target_status text,
  p_state_effective_at timestamptz,
  p_state_observed_at timestamptz,
  p_retire_work boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_initial_state_unset boolean := false;
  v_final_status text;
  v_fulfillment_retired boolean := false;
  v_released record;
begin
  -- record_paid_order serializes this PaymentIntent and performs inventory
  -- allocation. The financial transition remains in the same transaction, so
  -- no other worker can observe a newly inserted order as paid in between.
  v_order_id := public.record_paid_order(
    p_session_id,
    p_payment_reference,
    p_payment_provider,
    p_fulfillment,
    p_currency,
    p_amount_subtotal,
    p_amount_tax,
    p_amount_shipping,
    p_amount_total,
    p_customer,
    p_items,
    p_is_test_order
  );

  select o.stripe_state_effective_at is null
    into v_initial_state_unset
    from public.orders o
    where o.id = v_order_id
    for update;

  v_final_status := public.transition_stripe_order_state(
    v_order_id,
    p_target_status,
    p_state_effective_at,
    p_retire_work,
    p_state_observed_at
  );

  -- If Stripe was already fully refunded or a dispute was already lost before
  -- the first local record, release the just-created in-stock allocation. The
  -- preorder portion was retired by transition_stripe_order_state above.
  if coalesce(v_initial_state_unset, false)
     and (
       v_final_status = 'refunded'
       or (v_final_status = 'disputed' and coalesce(p_retire_work, true))
     ) then
    for v_released in
      select
        oi.sku,
        sum(oi.quantity - oi.preorder_qty)::integer as in_stock_quantity,
        sum(oi.quantity)::integer as total_quantity
      from public.order_items oi
      where oi.order_id = v_order_id
      group by oi.sku
      order by oi.sku
    loop
      update public.inventory i
        set on_hand = i.on_hand + greatest(v_released.in_stock_quantity, 0),
            units_sold = greatest(i.units_sold - v_released.total_quantity, 0),
            updated_at = coalesce(p_state_observed_at, clock_timestamp())
        where i.sku = v_released.sku;
    end loop;
  end if;

  select o.stripe_fulfillment_retired_at is not null
    into v_fulfillment_retired
    from public.orders o
    where o.id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'status', v_final_status,
    'fulfillment_retired', coalesce(v_fulfillment_retired, false)
  );
end;
$$;

revoke all on function public.transition_stripe_order_state(
  uuid, text, timestamptz, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.transition_stripe_order_state(
  uuid, text, timestamptz, boolean, timestamptz
) to service_role;

revoke all on function public.record_stripe_order_state(
  text, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb,
  boolean, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.record_stripe_order_state(
  text, text, text, text, text, integer, integer, integer, integer, jsonb, jsonb,
  boolean, text, timestamptz, timestamptz, boolean
) to service_role;

commit;
