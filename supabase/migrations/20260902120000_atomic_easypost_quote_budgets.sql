begin;

create or replace function public.reserve_easypost_quote(
  p_fingerprint text,
  p_session_fingerprint text,
  p_ip_fingerprint text,
  p_service_level text,
  p_parcel_plan jsonb,
  p_planned_ship_date date,
  p_expires_at timestamptz,
  p_parcel_count integer,
  p_daily_rating_limit integer,
  p_daily_verification_limit integer,
  p_monthly_overage_limit_cents integer,
  p_estimated_overage_cost_cents integer
) returns table(state text, quote_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_quote_id uuid;
  v_daily_ratings bigint;
  v_daily_verifications bigint;
  v_monthly_overage bigint;
  v_session_misses bigint;
  v_fingerprint_misses bigint;
  v_month_start date := date_trunc('month', v_now)::date;
  v_percent numeric;
begin
  if coalesce(length(p_fingerprint), 0) <> 64
     or coalesce(length(p_session_fingerprint), 0) <> 64
     or coalesce(length(p_ip_fingerprint), 0) <> 64
     or coalesce(p_service_level, '') not in ('normal', 'expedited')
     or coalesce(p_parcel_count, 0) < 1
     or coalesce(p_daily_rating_limit, -1) < 0
     or coalesce(p_daily_verification_limit, -1) < 0
     or coalesce(p_monthly_overage_limit_cents, -1) < 0
     or coalesce(p_estimated_overage_cost_cents, -1) < 0
     or coalesce(jsonb_typeof(p_parcel_plan), '') <> 'object'
     or p_expires_at is null
     or p_expires_at <= v_now then
    raise exception 'Invalid EasyPost quote reservation.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_fingerprint, 0));

  update checkout_shipping_quotes
    set status = 'expired', updated_at = v_now
    where fingerprint = p_fingerprint
      and status = 'quoted'
      and expires_at <= v_now;

  select id into v_quote_id
  from checkout_shipping_quotes
  where fingerprint = p_fingerprint
    and status = 'quoted'
    and payment_session_id is null
    and expires_at > v_now
  order by created_at desc
  limit 1;

  if v_quote_id is not null then
    insert into easypost_usage_ledger (
      event_type, session_fingerprint, ip_fingerprint, quote_fingerprint,
      quote_id, cache_hits
    ) values (
      'cache_hit', p_session_fingerprint, p_ip_fingerprint, p_fingerprint,
      v_quote_id, 1
    );
    return query select 'cache_hit'::text, v_quote_id;
    return;
  end if;

  select id into v_quote_id
  from checkout_shipping_quotes
  where fingerprint = p_fingerprint
    and status = 'rating'
    and created_at > v_now - interval '2 minutes'
  order by created_at desc
  limit 1;
  if v_quote_id is not null then
    return query select 'in_progress'::text, v_quote_id;
    return;
  end if;

  update checkout_shipping_quotes
    set status = 'cancelled', updated_at = v_now
    where fingerprint = p_fingerprint and status = 'rating';

  -- Only the reservation transaction is serialized. The provider calls run
  -- after this RPC commits, so a slow rating request never holds this lock.
  perform pg_advisory_xact_lock(hashtextextended('easypost-quote-budget-global-v1', 0));
  perform pg_advisory_xact_lock(
    hashtextextended('easypost-quote-session:' || p_session_fingerprint, 0)
  );

  select
    coalesce(sum(rated_shipments), 0),
    coalesce(sum(address_verifications), 0)
  into v_daily_ratings, v_daily_verifications
  from easypost_usage_ledger
  where created_at >= date_trunc('day', v_now);

  select coalesce(sum(estimated_overage_cost_cents), 0)
  into v_monthly_overage
  from easypost_usage_ledger
  where created_at >= date_trunc('month', v_now);

  select coalesce(sum(cache_misses), 0) into v_session_misses
  from easypost_usage_ledger
  where session_fingerprint = p_session_fingerprint
    and created_at >= v_now - interval '10 minutes';

  select coalesce(sum(cache_misses), 0) into v_fingerprint_misses
  from easypost_usage_ledger
  where quote_fingerprint = p_fingerprint
    and created_at >= v_now - interval '10 minutes';

  if v_session_misses >= 2
     or v_fingerprint_misses >= 2
     or v_daily_ratings + p_parcel_count > p_daily_rating_limit
     or v_daily_verifications + 1 > p_daily_verification_limit
     or v_monthly_overage + p_estimated_overage_cost_cents > p_monthly_overage_limit_cents then
    insert into easypost_usage_ledger (
      event_type, session_fingerprint, ip_fingerprint, quote_fingerprint,
      blocked_requests
    ) values (
      'blocked', p_session_fingerprint, p_ip_fingerprint, p_fingerprint, 1
    );
    return query select 'blocked'::text, null::uuid;
    return;
  end if;

  insert into checkout_shipping_quotes (
    status, provider, quote_json, postage_cents, packaging_cents,
    unrounded_cents, rounding_cents, discount_cents, charged_shipping_cents,
    shipping_margin_cents, currency, expires_at, fingerprint,
    session_fingerprint, service_level, parcel_plan, planned_ship_date
  ) values (
    'rating', 'easypost', '{}'::jsonb, 0, 0, 0, 0, 0, 0, 0, 'USD',
    p_expires_at, p_fingerprint, p_session_fingerprint, p_service_level,
    p_parcel_plan, p_planned_ship_date
  ) returning id into v_quote_id;

  insert into easypost_usage_ledger (
    event_type, session_fingerprint, ip_fingerprint, quote_fingerprint,
    quote_id, rating_operations, rated_shipments, address_verifications,
    cache_misses, estimated_overage_cost_cents
  ) values (
    'quote_reserved', p_session_fingerprint, p_ip_fingerprint, p_fingerprint,
    v_quote_id, 1, p_parcel_count, 1, 1, p_estimated_overage_cost_cents
  );

  if p_monthly_overage_limit_cents > 0 then
    v_percent := 100.0 * (v_monthly_overage + p_estimated_overage_cost_cents)
      / p_monthly_overage_limit_cents;
    if v_percent >= 50 then
      insert into easypost_usage_alerts (billing_month, threshold_percent, estimated_overage_cost_cents)
      values (v_month_start, 50, v_monthly_overage + p_estimated_overage_cost_cents)
      on conflict do nothing;
    end if;
    if v_percent >= 80 then
      insert into easypost_usage_alerts (billing_month, threshold_percent, estimated_overage_cost_cents)
      values (v_month_start, 80, v_monthly_overage + p_estimated_overage_cost_cents)
      on conflict do nothing;
    end if;
    if v_percent >= 100 then
      insert into easypost_usage_alerts (billing_month, threshold_percent, estimated_overage_cost_cents)
      values (v_month_start, 100, v_monthly_overage + p_estimated_overage_cost_cents)
      on conflict do nothing;
    end if;
  end if;

  return query select 'reserved'::text, v_quote_id;
end;
$$;

revoke all on function public.reserve_easypost_quote(
  text, text, text, text, jsonb, date, timestamptz, integer, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_easypost_quote(
  text, text, text, text, jsonb, date, timestamptz, integer, integer, integer, integer, integer
) to service_role;

commit;
