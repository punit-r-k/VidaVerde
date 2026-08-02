begin;

create extension if not exists "pgcrypto";

-- SECURITY DEFINER functions resolve application objects in public. Prevent
-- untrusted roles from creating shadow objects in that schema.
revoke create on schema public from public, anon, authenticated;

alter table orders
  add column if not exists customer_confirmation_email_claim_token uuid;

alter table email_jobs
  add column if not exists claim_token uuid,
  add column if not exists message_id text,
  add column if not exists last_error_code text;

alter table preorder_release_events
  add column if not exists ready_pickup_email_claim_token uuid,
  add column if not exists ready_pickup_email_claimed_at timestamptz;

-- Give legacy jobs a stable Message-ID before making the column mandatory.
-- Retries retain this value so a mail provider can recognize duplicate sends.
update email_jobs
set message_id = format(
  '<vida-verde-order-%s-job-%s@notifications.vida-verde>',
  coalesce(order_id::text, 'unknown'),
  id::text
)
where nullif(trim(coalesce(message_id, '')), '') is null;

alter table email_jobs alter column message_id set not null;

alter table email_jobs drop constraint if exists email_jobs_message_id_safe;
alter table email_jobs add constraint email_jobs_message_id_safe
  check (
    length(message_id) between 3 and 320
    and message_id !~ E'[\\r\\n]'
  ) not valid;
alter table email_jobs validate constraint email_jobs_message_id_safe;

-- Preserve existing active work while introducing lease tokens. Pending jobs
-- receive an enqueue claim; a worker replaces it when it starts processing.
update email_jobs
set claim_token = coalesce(claim_token, gen_random_uuid()),
    claimed_at = coalesce(claimed_at, updated_at, created_at, now())
where status in ('pending', 'processing');

update email_jobs
set claim_token = null,
    claimed_at = null
where status in ('sent', 'failed');

with active_job as (
  select distinct on (ej.order_id)
    ej.order_id,
    ej.claim_token,
    ej.claimed_at
  from email_jobs ej
  where ej.order_id is not null
    and ej.status in ('pending', 'processing')
  order by ej.order_id, ej.created_at, ej.id
)
update orders o
set customer_confirmation_email_claim_token = aj.claim_token,
    customer_confirmation_email_claimed_at = aj.claimed_at
from active_job aj
where o.id = aj.order_id
  and o.customer_confirmation_email_sent_at is null;

-- A legacy direct-send claim has no job from which to copy a token. Tokenize
-- it so health checks and the new atomic enqueue path can recover it safely.
update orders
set customer_confirmation_email_claim_token = gen_random_uuid()
where customer_confirmation_email_sent_at is null
  and customer_confirmation_email_claimed_at is not null
  and customer_confirmation_email_claim_token is null;

update orders
set customer_confirmation_email_claim_token = null,
    customer_confirmation_email_claimed_at = null
where customer_confirmation_email_sent_at is not null;

drop index if exists email_jobs_order_confirmation_active_idx;
create unique index email_jobs_order_confirmation_active_idx
  on email_jobs (order_id, type)
  where type = 'order_confirmation'
    and status in ('pending', 'processing');

create unique index if not exists email_jobs_message_id_uidx
  on email_jobs (message_id);

create index if not exists email_jobs_processing_claim_idx
  on email_jobs (claimed_at, created_at, id)
  where status = 'processing';

create index if not exists orders_confirmation_email_claim_idx
  on orders (customer_confirmation_email_claimed_at, id)
  where customer_confirmation_email_sent_at is null
    and customer_confirmation_email_claimed_at is not null;

create index if not exists preorder_release_events_ready_email_unsent_idx
  on preorder_release_events (order_id, created_at, id)
  where ready_pickup_email_sent_at is null;

create index if not exists preorder_release_events_ready_email_claim_idx
  on preorder_release_events (ready_pickup_email_claimed_at, order_id, id)
  where ready_pickup_email_sent_at is null
    and ready_pickup_email_claim_token is not null;
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
  p_items jsonb,
  p_is_test_order boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  v_order_id := record_paid_order(
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
    p_items
  );

  if coalesce(p_is_test_order, false) then
    update orders
      set is_test_order = true
      where id = v_order_id
        and not is_test_order;
  end if;

  return v_order_id;
end;
$$;


create or replace function enqueue_order_confirmation_email(
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
  v_order orders%rowtype;
  v_existing email_jobs%rowtype;
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
    from orders o
    where o.id = p_order_id
    for update;

  if not found
     or v_order.customer_confirmation_email_sent_at is not null
     or v_order.status <> 'paid' then
    return null;
  end if;

  select ej.*
    into v_existing
    from email_jobs ej
    where ej.order_id = p_order_id
      and ej.type = 'order_confirmation'
      and ej.status in ('pending', 'processing')
    order by ej.created_at, ej.id
    limit 1
    for update;

  if found then
    update orders
      set customer_confirmation_email_claimed_at = v_existing.claimed_at,
          customer_confirmation_email_claim_token = v_existing.claim_token
      where id = p_order_id;
    return v_existing.id;
  end if;

  -- A terminal failure requires an explicit producer retry; checkout replay
  -- must not silently grant an unlimited number of SMTP attempts.
  select ej.*
    into v_existing
    from email_jobs ej
    where ej.order_id = p_order_id
      and ej.type = 'order_confirmation'
      and ej.status = 'failed'
    order by ej.processed_at desc nulls last, ej.created_at desc, ej.id desc
    limit 1
    for update;

  if found then
    return v_existing.id;
  end if;

  -- Respect an in-flight legacy/direct-delivery claim for 30 minutes. Stale
  -- orphan claims are recovered by the atomic insert below.
  if v_order.customer_confirmation_email_claimed_at is not null
     and v_order.customer_confirmation_email_claimed_at > v_now - interval '30 minutes'
     and v_order.customer_confirmation_email_claim_token is distinct from p_claim_token then
    return null;
  end if;

  insert into email_jobs (
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

  update orders
    set customer_confirmation_email_claimed_at = v_now,
        customer_confirmation_email_claim_token = p_claim_token
    where id = p_order_id;

  return v_job_id;
end;
$$;

create or replace function claim_email_job(
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
  v_order orders%rowtype;
  v_job email_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null or p_stale_before is null then
    return null;
  end if;

  select ej.order_id
    into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return null;
  end if;

  -- Lock order first in every queue RPC to prevent order/job deadlocks.
  select *
    into v_order
    from orders o
    where o.id = v_order_id
    for update;

  if not found then
    return null;
  end if;

  select *
    into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.type <> 'order_confirmation'
     or v_job.attempts >= v_job.max_attempts then
    return null;
  end if;

  if v_order.customer_confirmation_email_sent_at is not null then
    update email_jobs
      set status = 'sent',
          processed_at = coalesce(processed_at, v_order.customer_confirmation_email_sent_at),
          claim_token = null,
          claimed_at = null,
          last_error_code = null,
          last_error = null
      where id = v_job.id;
    update orders
      set customer_confirmation_email_claim_token = null,
          customer_confirmation_email_claimed_at = null
      where id = v_order.id;
    return null;
  end if;

  if v_order.status <> 'paid' then
    update email_jobs
      set status = 'failed',
          processed_at = v_now,
          claim_token = null,
          claimed_at = null,
          last_error_code = 'order_ineligible',
          last_error = 'The order is no longer eligible for confirmation delivery.'
      where id = v_job.id;
    update orders
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

  update email_jobs
    set status = 'processing',
        claim_token = p_claim_token,
        claimed_at = v_now,
        processed_at = null,
        last_error_code = null,
        last_error = null
    where id = v_job.id
    returning * into v_job;

  update orders
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

create or replace function reschedule_or_fail_email_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error text,
  p_consume_attempt boolean,
  p_next_available_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid;
  v_job email_jobs%rowtype;
  v_error_code text := left(
    coalesce(nullif(lower(trim(p_error_code)), ''), 'delivery_failed'),
    80
  );
  v_error text := left(trim(coalesce(p_error, 'Email delivery failed.')), 1000);
  v_attempts integer;
  v_terminal boolean;
  v_status text;
begin
  if p_job_id is null or p_claim_token is null then
    return null;
  end if;

  select ej.order_id into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return null;
  end if;

  perform o.id from orders o where o.id = v_order_id for update;
  if not found then
    return null;
  end if;

  select * into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.claim_token is distinct from p_claim_token then
    return null;
  end if;

  v_attempts := v_job.attempts + case when coalesce(p_consume_attempt, false) then 1 else 0 end;
  v_terminal := v_error_code in ('invalid_payload', 'unknown_job_type', 'order_ineligible')
    or v_attempts >= v_job.max_attempts;
  v_status := case when v_terminal then 'failed' else 'pending' end;

  update email_jobs
    set status = v_status,
        attempts = v_attempts,
        available_at = case
          when v_terminal then v_now
          else greatest(coalesce(p_next_available_at, v_now), v_now)
        end,
        processed_at = case when v_terminal then v_now else null end,
        claim_token = null,
        claimed_at = null,
        last_error_code = nullif(v_error_code, ''),
        last_error = nullif(v_error, '')
    where id = v_job.id;

  update orders
    set customer_confirmation_email_claim_token = null,
        customer_confirmation_email_claimed_at = null
    where id = v_order_id
      and customer_confirmation_email_claim_token = p_claim_token;

  return jsonb_build_object(
    'id', v_job.id,
    'status', v_status,
    'attempts', v_attempts,
    'max_attempts', v_job.max_attempts,
    'terminal', v_terminal,
    'exhausted', v_terminal,
    'available_at', case
      when v_terminal then v_now
      else greatest(coalesce(p_next_available_at, v_now), v_now)
    end
  );
end;
$$;

create or replace function complete_email_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_sent_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent_at timestamptz := coalesce(p_sent_at, clock_timestamp());
  v_order_id uuid;
  v_order orders%rowtype;
  v_job email_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null then
    return false;
  end if;

  select ej.order_id into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return false;
  end if;

  select * into v_order
    from orders o
    where o.id = v_order_id
    for update;

  if not found then
    return false;
  end if;

  select * into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.claim_token is distinct from p_claim_token
     or v_order.customer_confirmation_email_claim_token is distinct from p_claim_token then
    return false;
  end if;

  update orders
    set customer_confirmation_email_sent_at = coalesce(customer_confirmation_email_sent_at, v_sent_at),
        customer_confirmation_email_claimed_at = null,
        customer_confirmation_email_claim_token = null
    where id = v_order_id;

  update email_jobs
    set status = 'sent',
        processed_at = v_sent_at,
        claimed_at = null,
        claim_token = null,
        last_error_code = null,
        last_error = null
    where id = v_job.id;

  return true;
end;
$$;

create or replace function retry_failed_email_job(
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
  v_order orders%rowtype;
  v_job email_jobs%rowtype;
  v_claim_token uuid := gen_random_uuid();
begin
  if p_job_id is null then
    return false;
  end if;

  select ej.order_id into v_order_id
    from email_jobs ej
    where ej.id = p_job_id;

  if not found or v_order_id is null then
    return false;
  end if;

  select * into v_order
    from orders o
    where o.id = v_order_id
    for update;

  if not found
     or v_order.status <> 'paid'
     or v_order.customer_confirmation_email_sent_at is not null then
    return false;
  end if;

  select * into v_job
    from email_jobs ej
    where ej.id = p_job_id
    for update;

  if not found
     or v_job.type <> 'order_confirmation'
     or v_job.status <> 'failed'
     or exists (
       select 1
       from email_jobs active_job
       where active_job.order_id = v_order_id
         and active_job.type = 'order_confirmation'
         and active_job.status in ('pending', 'processing')
         and active_job.id <> v_job.id
     ) then
    return false;
  end if;

  update email_jobs
    set status = 'pending',
        attempts = 0,
        available_at = greatest(coalesce(p_available_at, v_now), v_now),
        processed_at = null,
        claimed_at = v_now,
        claim_token = v_claim_token,
        last_error_code = null,
        last_error = null
    where id = v_job.id;

  update orders
    set customer_confirmation_email_claimed_at = v_now,
        customer_confirmation_email_claim_token = v_claim_token
    where id = v_order_id;

  return true;
end;
$$;

create or replace function claim_preorder_ready_email_events(
  p_order_id uuid,
  p_event_ids uuid[],
  p_claim_token uuid,
  p_stale_before timestamptz,
  p_cutoff timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_ids uuid[];
  v_unsent_ids uuid[];
  v_all_old_enough boolean;
  v_all_claimable boolean;
  v_updated integer := 0;
begin
  if p_order_id is null
     or p_claim_token is null
     or p_stale_before is null
     or p_cutoff is null
     or coalesce(cardinality(p_event_ids), 0) = 0 then
    return false;
  end if;

  select array_agg(distinct event_id order by event_id)
    into v_requested_ids
    from unnest(p_event_ids) as requested(event_id)
    where event_id is not null;

  if coalesce(cardinality(v_requested_ids), 0) <> cardinality(p_event_ids) then
    return false;
  end if;

  -- The order lock serializes claims and also prevents a concurrent FK insert
  -- from adding a release event between the exact-set check and claim update.
  perform o.id
    from orders o
    where o.id = p_order_id
      and o.status = 'paid'
    for update;

  if not found then
    return false;
  end if;

  perform pre.id
    from preorder_release_events pre
    where pre.order_id = p_order_id
      and pre.ready_pickup_email_sent_at is null
    order by pre.id
    for update;

  select
    array_agg(pre.id order by pre.id),
    bool_and(pre.created_at <= p_cutoff),
    bool_and(
      pre.ready_pickup_email_claim_token is null
      or pre.ready_pickup_email_claim_token = p_claim_token
      or pre.ready_pickup_email_claimed_at is null
      or pre.ready_pickup_email_claimed_at <= p_stale_before
    )
    into v_unsent_ids, v_all_old_enough, v_all_claimable
    from preorder_release_events pre
    where pre.order_id = p_order_id
      and pre.ready_pickup_email_sent_at is null;

  if coalesce(cardinality(v_unsent_ids), 0) = 0
     or v_requested_ids is distinct from v_unsent_ids
     or not coalesce(v_all_old_enough, false)
     or not coalesce(v_all_claimable, false) then
    return false;
  end if;

  update preorder_release_events
    set ready_pickup_email_claim_token = p_claim_token,
        ready_pickup_email_claimed_at = clock_timestamp()
    where order_id = p_order_id
      and id = any(v_unsent_ids)
      and ready_pickup_email_sent_at is null;
  get diagnostics v_updated = row_count;

  return v_updated = cardinality(v_unsent_ids);
end;
$$;

create or replace function release_preorder_ready_email_events(
  p_event_ids uuid[],
  p_claim_token uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_ids uuid[];
  v_matching_ids uuid[];
  v_updated integer := 0;
begin
  if p_claim_token is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    return 0;
  end if;

  select array_agg(distinct event_id order by event_id)
    into v_requested_ids
    from unnest(p_event_ids) as requested(event_id)
    where event_id is not null;

  if coalesce(cardinality(v_requested_ids), 0) <> cardinality(p_event_ids) then
    return 0;
  end if;

  perform pre.id
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
    order by pre.id
    for update;

  select array_agg(pre.id order by pre.id)
    into v_matching_ids
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
      and pre.ready_pickup_email_sent_at is null
      and pre.ready_pickup_email_claim_token = p_claim_token;

  if v_matching_ids is distinct from v_requested_ids then
    return 0;
  end if;

  update preorder_release_events
    set ready_pickup_email_claim_token = null,
        ready_pickup_email_claimed_at = null
    where id = any(v_requested_ids)
      and ready_pickup_email_sent_at is null
      and ready_pickup_email_claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function complete_preorder_ready_email_events(
  p_event_ids uuid[],
  p_claim_token uuid,
  p_sent_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_ids uuid[];
  v_matching_ids uuid[];
  v_updated integer := 0;
begin
  if p_claim_token is null or coalesce(cardinality(p_event_ids), 0) = 0 then
    return 0;
  end if;

  select array_agg(distinct event_id order by event_id)
    into v_requested_ids
    from unnest(p_event_ids) as requested(event_id)
    where event_id is not null;

  if coalesce(cardinality(v_requested_ids), 0) <> cardinality(p_event_ids) then
    return 0;
  end if;

  perform pre.id
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
    order by pre.id
    for update;

  select array_agg(pre.id order by pre.id)
    into v_matching_ids
    from preorder_release_events pre
    where pre.id = any(v_requested_ids)
      and pre.ready_pickup_email_sent_at is null
      and pre.ready_pickup_email_claim_token = p_claim_token;

  if v_matching_ids is distinct from v_requested_ids then
    return 0;
  end if;

  update preorder_release_events
    set ready_pickup_email_sent_at = coalesce(p_sent_at, clock_timestamp()),
        ready_pickup_email_claim_token = null,
        ready_pickup_email_claimed_at = null
    where id = any(v_requested_ids)
      and ready_pickup_email_sent_at is null
      and ready_pickup_email_claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Harden only
-- the application's known RPCs so extension/vendor functions in public are not
-- changed. to_regprocedure keeps this safe on projects with incomplete legacy
-- migration history.
do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.consume_api_rate_limit(text,text,integer,integer)',
    'public.record_paid_order(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb)',
    'public.record_paid_order(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb,boolean)',
    'public.transition_stripe_order_state(uuid,text,timestamptz)',
    'public.transition_stripe_order_state(uuid,text,timestamptz,boolean)',
    'public.sync_shipment_for_order(uuid)',
    'public.sync_all_shipments()',
    'public.get_admin_prep_data(date,timestamptz,timestamptz)',
    'public.apply_restock(text,integer)',
    'public.set_expected_restock_date(text,date)',
    'public.get_non_test_units_sold()',
    'public.unsubscribe_email_addresses(text[],text,text)',
    'public.subscribe_email_address(text,text,text,text)',
    'public.apply_email_list_changes(text[],text[])',
    'public.enqueue_order_confirmation_email(uuid,jsonb,uuid,text)',
    'public.claim_email_job(uuid,timestamptz,uuid)',
    'public.reschedule_or_fail_email_job(uuid,uuid,text,text,boolean,timestamptz)',
    'public.complete_email_job(uuid,uuid,timestamptz)',
    'public.retry_failed_email_job(uuid,timestamptz)',
    'public.claim_preorder_ready_email_events(uuid,uuid[],uuid,timestamptz,timestamptz)',
    'public.release_preorder_ready_email_events(uuid[],uuid)',
    'public.complete_preorder_ready_email_events(uuid[],uuid,timestamptz)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end if;
  end loop;
end $$;

commit;
