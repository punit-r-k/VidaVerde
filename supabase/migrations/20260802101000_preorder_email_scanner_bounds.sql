begin;

-- Select a bounded number of whole order batches. Limiting raw event rows can
-- split one order's exact claim set and permanently starve every later order.
create or replace function public.get_preorder_ready_email_candidate_orders(
  p_cutoff timestamptz,
  p_stale_before timestamptz,
  p_limit integer default 4,
  p_max_events_per_order integer default 200
) returns table(order_id uuid, event_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    pre.order_id,
    count(*)::integer as event_count
  from preorder_release_events pre
  join orders o on o.id = pre.order_id
  where o.status = 'paid'
    and pre.ready_pickup_email_sent_at is null
  group by pre.order_id
  having max(pre.created_at) <= p_cutoff
    and count(*) <= least(greatest(coalesce(p_max_events_per_order, 200), 1), 1000)
    and bool_and(
      pre.ready_pickup_email_claim_token is null
      or pre.ready_pickup_email_claimed_at is null
      or pre.ready_pickup_email_claimed_at <= p_stale_before
    )
  order by min(pre.created_at), pre.order_id
  limit least(greatest(coalesce(p_limit, 4), 1), 25);
$$;

-- Oversized batches are quarantined from the scanner instead of blocking the
-- queue. Surface them in producer health so they can be investigated safely.
create or replace function public.get_preorder_ready_email_backlog_health(
  p_cutoff timestamptz,
  p_max_events_per_order integer default 200
) returns table(poisoned_order_count bigint, poisoned_event_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with oversized as (
    select count(*)::bigint as event_count
    from preorder_release_events pre
    join orders o on o.id = pre.order_id
    where o.status = 'paid'
      and pre.ready_pickup_email_sent_at is null
    group by pre.order_id
    having min(pre.created_at) <= p_cutoff
      and count(*) > least(greatest(coalesce(p_max_events_per_order, 200), 1), 1000)
  )
  select
    count(*)::bigint as poisoned_order_count,
    coalesce(sum(oversized.event_count), 0)::bigint as poisoned_event_count
  from oversized;
$$;

revoke all on function public.get_preorder_ready_email_candidate_orders(
  timestamptz, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_preorder_ready_email_candidate_orders(
  timestamptz, timestamptz, integer, integer
) to service_role;

revoke all on function public.get_preorder_ready_email_backlog_health(
  timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.get_preorder_ready_email_backlog_health(
  timestamptz, integer
) to service_role;

commit;
