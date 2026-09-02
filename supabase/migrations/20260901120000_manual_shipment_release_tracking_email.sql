alter table public.shipments
  add column if not exists tracking_email_sent_at timestamptz,
  add column if not exists active_release_quote_id uuid
    references public.shipment_quotes(id) on delete set null;

alter table public.email_jobs
  add column if not exists shipment_id uuid references public.shipments(id) on delete cascade;

alter table public.email_jobs drop constraint if exists email_jobs_type_check;
alter table public.email_jobs add constraint email_jobs_type_check
  check (type in ('order_confirmation', 'shipment_tracking'));

create unique index if not exists email_jobs_shipment_tracking_uidx
  on public.email_jobs (shipment_id, type)
  where type = 'shipment_tracking';

create or replace function public.enqueue_shipment_tracking_email(
  p_shipment_id uuid,
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
  v_shipment shipments%rowtype;
  v_order orders%rowtype;
  v_order_id uuid;
  v_existing email_jobs%rowtype;
  v_job_id uuid;
begin
  if p_shipment_id is null or p_claim_token is null then
    raise exception 'A shipment id and claim token are required.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The shipment tracking payload must be a JSON object.';
  end if;
  if length(v_message_id) not between 3 and 320 or v_message_id ~ E'[\r\n]' then
    raise exception 'The shipment tracking Message-ID is invalid.';
  end if;

  select order_id into v_order_id from shipments where id = p_shipment_id;
  if not found then return null; end if;
  select * into v_order from orders where id = v_order_id for update;
  if not found then return null; end if;
  select * into v_shipment from shipments where id = p_shipment_id for update;
  if not found
     or v_order.status <> 'paid'
     or v_order.fulfillment <> 'ship'
     or coalesce(v_order.is_test_order, false)
     or v_shipment.status not in ('label_purchased', 'shipped', 'delivered')
     or nullif(trim(coalesce(v_shipment.tracking_number, '')), '') is null then
    return null;
  end if;

  select * into v_existing
    from email_jobs
    where shipment_id = p_shipment_id and type = 'shipment_tracking'
    order by created_at, id limit 1 for update;
  if found then return v_existing.id; end if;
  if v_shipment.tracking_email_sent_at is not null then return null; end if;

  insert into email_jobs (
    type, status, order_id, shipment_id, payload, available_at,
    claimed_at, claim_token, message_id
  ) values (
    'shipment_tracking', 'pending', v_shipment.order_id, p_shipment_id,
    p_payload || jsonb_build_object('shipmentId', p_shipment_id::text),
    v_now, v_now, p_claim_token, v_message_id
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.claim_shipment_tracking_email_job(
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
  v_job email_jobs%rowtype;
  v_shipment shipments%rowtype;
  v_order orders%rowtype;
  v_shipment_id uuid;
  v_order_id uuid;
begin
  if p_job_id is null or p_claim_token is null or p_stale_before is null then return null; end if;
  select shipment_id, order_id into v_shipment_id, v_order_id
    from email_jobs where id = p_job_id and type = 'shipment_tracking';
  if not found or v_shipment_id is null or v_order_id is null then return null; end if;
  select * into v_order from orders where id = v_order_id for update;
  if not found then return null; end if;
  select * into v_shipment from shipments where id = v_shipment_id for update;
  if not found then return null; end if;
  select * into v_job from email_jobs where id = p_job_id for update;
  if not found or v_job.type <> 'shipment_tracking' or v_job.shipment_id is null
     or v_job.attempts >= v_job.max_attempts then return null; end if;

  if v_shipment.tracking_email_sent_at is not null then
    update email_jobs set status = 'sent',
      processed_at = coalesce(processed_at, v_shipment.tracking_email_sent_at),
      claimed_at = null, claim_token = null, last_error_code = null, last_error = null
    where id = v_job.id;
    return null;
  end if;
  if v_order.status <> 'paid' or v_order.fulfillment <> 'ship'
     or coalesce(v_order.is_test_order, false)
     or v_shipment.status not in ('label_purchased', 'shipped', 'delivered')
     or nullif(trim(coalesce(v_shipment.tracking_number, '')), '') is null then
    update email_jobs set status = 'failed', processed_at = v_now,
      claimed_at = null, claim_token = null,
      last_error_code = 'order_ineligible',
      last_error = 'The shipment is no longer eligible for tracking delivery.'
    where id = v_job.id;
    return null;
  end if;
  if not (
    (v_job.status = 'pending' and v_job.available_at <= v_now)
    or (v_job.status = 'processing' and v_job.claimed_at <= p_stale_before)
  ) then return null; end if;

  update email_jobs set status = 'processing', claim_token = p_claim_token,
    claimed_at = v_now, processed_at = null, last_error_code = null, last_error = null
  where id = v_job.id returning * into v_job;
  return jsonb_build_object(
    'id', v_job.id, 'type', v_job.type, 'order_id', v_job.order_id,
    'shipment_id', v_job.shipment_id, 'payload', v_job.payload,
    'attempts', v_job.attempts, 'max_attempts', v_job.max_attempts,
    'message_id', v_job.message_id, 'claim_token', v_job.claim_token
  );
end;
$$;

create or replace function public.complete_shipment_tracking_email_job(
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
  v_job email_jobs%rowtype;
  v_shipment_id uuid;
  v_order_id uuid;
begin
  if p_job_id is null or p_claim_token is null then return false; end if;
  select shipment_id, order_id into v_shipment_id, v_order_id
    from email_jobs where id = p_job_id and type = 'shipment_tracking';
  if not found or v_shipment_id is null or v_order_id is null then return false; end if;
  perform id from orders where id = v_order_id for update;
  if not found then return false; end if;
  perform id from shipments where id = v_shipment_id for update;
  if not found then return false; end if;
  select * into v_job from email_jobs where id = p_job_id for update;
  if not found or v_job.type <> 'shipment_tracking' or v_job.shipment_id is null
     or v_job.status <> 'processing'
     or v_job.claim_token is distinct from p_claim_token then return false; end if;
  update shipments set tracking_email_sent_at = coalesce(tracking_email_sent_at, v_sent_at)
    where id = v_job.shipment_id;
  update email_jobs set status = 'sent', processed_at = v_sent_at,
    claimed_at = null, claim_token = null, last_error_code = null, last_error = null
    where id = v_job.id;
  return true;
end;
$$;

create or replace function public.retry_failed_shipment_tracking_email_job(
  p_job_id uuid,
  p_available_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job email_jobs%rowtype;
  v_shipment shipments%rowtype;
  v_order orders%rowtype;
  v_shipment_id uuid;
  v_order_id uuid;
begin
  select shipment_id, order_id into v_shipment_id, v_order_id
    from email_jobs where id = p_job_id and type = 'shipment_tracking';
  if not found or v_shipment_id is null or v_order_id is null then return false; end if;
  select * into v_order from orders where id = v_order_id for update;
  if not found then return false; end if;
  select * into v_shipment from shipments where id = v_shipment_id for update;
  if not found or v_shipment.tracking_email_sent_at is not null
     or v_shipment.status not in ('label_purchased', 'shipped', 'delivered') then return false; end if;
  select * into v_job from email_jobs where id = p_job_id for update;
  if not found or v_job.type <> 'shipment_tracking' or v_job.status <> 'failed'
     or v_job.shipment_id is null then return false; end if;
  if v_order.status <> 'paid' or v_order.fulfillment <> 'ship'
     or coalesce(v_order.is_test_order, false) then return false; end if;
  update email_jobs set status = 'pending', attempts = 0,
    available_at = greatest(coalesce(p_available_at, v_now), v_now),
    processed_at = null, claimed_at = null, claim_token = null,
    last_error_code = null, last_error = null
  where id = v_job.id;
  return true;
end;
$$;

revoke all on function public.enqueue_shipment_tracking_email(uuid,jsonb,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_shipment_tracking_email_job(uuid,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.complete_shipment_tracking_email_job(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.retry_failed_shipment_tracking_email_job(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_shipment_tracking_email(uuid,jsonb,uuid,text) to service_role;
grant execute on function public.claim_shipment_tracking_email_job(uuid,timestamptz,uuid) to service_role;
grant execute on function public.complete_shipment_tracking_email_job(uuid,uuid,timestamptz) to service_role;
grant execute on function public.retry_failed_shipment_tracking_email_job(uuid,timestamptz) to service_role;
