alter table public.checkout_shipping_quotes
  drop constraint if exists checkout_shipping_quotes_status_check;

update public.checkout_shipping_quotes
  set status = 'purchased'
  where status = 'label_purchased';

alter table public.checkout_shipping_quotes
  add column if not exists fingerprint text,
  add column if not exists session_fingerprint text,
  add column if not exists parcel_plan jsonb not null default '{}'::jsonb
    check (jsonb_typeof(parcel_plan) = 'object'),
  add column if not exists planned_ship_date date,
  add column if not exists carrier text,
  add column if not exists service text,
  add column if not exists verified_address_id text,
  add column if not exists financial_invariant_version integer,
  add column if not exists shipping_margin_cents integer not null default 0
    check (shipping_margin_cents >= 0);

update public.checkout_shipping_quotes
  set financial_invariant_version = 0
  where financial_invariant_version is null;
alter table public.checkout_shipping_quotes
  alter column financial_invariant_version set default 1,
  alter column financial_invariant_version set not null;

alter table public.checkout_shipping_quotes
  add constraint checkout_shipping_quotes_status_check
  check (status in ('rating', 'quoted', 'attached', 'purchased', 'expired', 'cancelled'));

alter table public.checkout_shipping_quotes
  drop constraint if exists checkout_shipping_quotes_charged_shipping_check,
  drop constraint if exists checkout_shipping_quotes_discount_cents_check,
  drop constraint if exists checkout_shipping_quotes_no_hidden_subsidy,
  drop constraint if exists checkout_shipping_quotes_cost_coverage,
  drop constraint if exists checkout_shipping_quotes_margin_matches;

alter table public.checkout_shipping_quotes
  add constraint checkout_shipping_quotes_no_hidden_subsidy
    check (financial_invariant_version = 0 or discount_cents = 0),
  add constraint checkout_shipping_quotes_cost_coverage
    check (financial_invariant_version = 0 or charged_shipping_cents >= postage_cents + packaging_cents),
  add constraint checkout_shipping_quotes_margin_matches
    check (financial_invariant_version = 0 or shipping_margin_cents = charged_shipping_cents - postage_cents - packaging_cents);

create index if not exists checkout_shipping_quotes_fingerprint_idx
  on public.checkout_shipping_quotes (fingerprint, status, expires_at desc);

create table if not exists public.easypost_usage_ledger (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'quote_reserved', 'cache_hit', 'blocked', 'quote_failed', 'label_purchased'
  )),
  session_fingerprint text,
  ip_fingerprint text,
  quote_fingerprint text,
  quote_id uuid references public.checkout_shipping_quotes(id) on delete set null,
  rating_operations integer not null default 0 check (rating_operations >= 0),
  rated_shipments integer not null default 0 check (rated_shipments >= 0),
  address_verifications integer not null default 0 check (address_verifications >= 0),
  labels_purchased integer not null default 0 check (labels_purchased >= 0),
  cache_hits integer not null default 0 check (cache_hits >= 0),
  cache_misses integer not null default 0 check (cache_misses >= 0),
  blocked_requests integer not null default 0 check (blocked_requests >= 0),
  failed_quote_requests integer not null default 0 check (failed_quote_requests >= 0),
  estimated_overage_cost_cents integer not null default 0
    check (estimated_overage_cost_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists easypost_usage_ledger_created_idx
  on public.easypost_usage_ledger (created_at desc);
create index if not exists easypost_usage_ledger_session_idx
  on public.easypost_usage_ledger (session_fingerprint, created_at desc);
create index if not exists easypost_usage_ledger_quote_fingerprint_idx
  on public.easypost_usage_ledger (quote_fingerprint, created_at desc);

create table if not exists public.easypost_usage_alerts (
  id bigint generated always as identity primary key,
  billing_month date not null,
  threshold_percent integer not null check (threshold_percent in (50, 80, 100)),
  estimated_overage_cost_cents integer not null check (estimated_overage_cost_cents >= 0),
  created_at timestamptz not null default now(),
  unique (billing_month, threshold_percent)
);

alter table public.easypost_usage_ledger enable row level security;
alter table public.easypost_usage_alerts enable row level security;
revoke all on public.easypost_usage_ledger from public, anon, authenticated;
revoke all on public.easypost_usage_alerts from public, anon, authenticated;

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
     or p_service_level not in ('normal', 'expedited')
     or p_parcel_count < 1
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

  select
    coalesce(sum(rating_operations), 0),
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
     or v_daily_ratings + 1 > p_daily_rating_limit
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

create or replace function public.fail_easypost_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update checkout_shipping_quotes
    set status = 'cancelled', updated_at = now()
    where id = p_quote_id and status = 'rating';
  insert into easypost_usage_ledger (event_type, quote_id, failed_quote_requests)
    values ('quote_failed', p_quote_id, 1);
end;
$$;

create or replace function public.get_easypost_usage_summary()
returns table(
  billing_month date,
  rating_operations bigint,
  rated_shipments bigint,
  address_verifications bigint,
  labels_purchased bigint,
  cache_hits bigint,
  cache_misses bigint,
  blocked_requests bigint,
  failed_quote_requests bigint,
  estimated_overage_cost_cents bigint,
  shipping_revenue_cents bigint,
  postage_cents bigint,
  packaging_cents bigint,
  shipping_margin_cents bigint
)
language sql
security definer
set search_path = public
as $$
  with usage as (
    select
      coalesce(sum(rating_operations), 0)::bigint rating_operations,
      coalesce(sum(rated_shipments), 0)::bigint rated_shipments,
      coalesce(sum(address_verifications), 0)::bigint address_verifications,
      coalesce(sum(labels_purchased), 0)::bigint labels_purchased,
      coalesce(sum(cache_hits), 0)::bigint cache_hits,
      coalesce(sum(cache_misses), 0)::bigint cache_misses,
      coalesce(sum(blocked_requests), 0)::bigint blocked_requests,
      coalesce(sum(failed_quote_requests), 0)::bigint failed_quote_requests,
      coalesce(sum(estimated_overage_cost_cents), 0)::bigint estimated_overage_cost_cents
    from easypost_usage_ledger
    where created_at >= date_trunc('month', now())
  ), financials as (
    select
      coalesce(sum(charged_shipping_cents), 0)::bigint shipping_revenue_cents,
      coalesce(sum(postage_cents), 0)::bigint postage_cents,
      coalesce(sum(packaging_cents), 0)::bigint packaging_cents,
      coalesce(sum(shipping_margin_cents), 0)::bigint shipping_margin_cents
    from checkout_shipping_quotes
    where created_at >= date_trunc('month', now())
      and status in ('attached', 'purchased')
  )
  select date_trunc('month', now())::date, usage.*, financials.*
  from usage cross join financials;
$$;

revoke all on function public.reserve_easypost_quote(
  text, text, text, text, jsonb, date, timestamptz, integer, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.fail_easypost_quote(uuid) from public, anon, authenticated;
revoke all on function public.get_easypost_usage_summary() from public, anon, authenticated;
grant execute on function public.reserve_easypost_quote(
  text, text, text, text, jsonb, date, timestamptz, integer, integer, integer, integer, integer
) to service_role;
grant execute on function public.fail_easypost_quote(uuid) to service_role;
grant execute on function public.get_easypost_usage_summary() to service_role;
