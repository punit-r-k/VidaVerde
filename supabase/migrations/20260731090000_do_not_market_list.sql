create table if not exists do_not_market (
  email text primary key,
  reason text not null default 'manual',
  source_message_id text,
  unsubscribed_at timestamptz not null default now(),
  check (email = lower(trim(email)))
);

create index if not exists do_not_market_unsubscribed_at_idx
  on do_not_market (unsubscribed_at desc);

alter table do_not_market enable row level security;
revoke all on table do_not_market from public, anon, authenticated;

create or replace function unsubscribe_email_addresses(
  p_emails text[],
  p_reason text default 'manual',
  p_source_message_id text default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_emails text[];
  v_removed integer := 0;
begin
  select array_agg(distinct lower(trim(value)))
    into v_emails
  from unnest(coalesce(p_emails, array[]::text[])) as value
  where trim(value) <> '';

  if coalesce(array_length(v_emails, 1), 0) = 0 then
    return 0;
  end if;

  insert into do_not_market (email, reason, source_message_id, unsubscribed_at)
  select
    value,
    coalesce(nullif(trim(p_reason), ''), 'manual'),
    nullif(trim(p_source_message_id), ''),
    now()
  from unnest(v_emails) as value
  on conflict (email) do update
  set reason = excluded.reason,
      source_message_id = coalesce(excluded.source_message_id, do_not_market.source_message_id),
      unsubscribed_at = excluded.unsubscribed_at;

  delete from email_signups
  where lower(trim(email)) = any(v_emails);
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

create or replace function subscribe_email_address(
  p_email text,
  p_source text default 'website',
  p_ip_address text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  delete from email_signups where lower(trim(email)) = v_email;
  delete from do_not_market where email = v_email;

  insert into email_signups (email, source, ip_address, user_agent)
  values (
    v_email,
    coalesce(nullif(trim(p_source), ''), 'website'),
    p_ip_address,
    p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function unsubscribe_email_addresses(text[], text, text)
  from public, anon, authenticated;
revoke execute on function subscribe_email_address(text, text, text, text)
  from public, anon, authenticated;
grant execute on function unsubscribe_email_addresses(text[], text, text)
  to service_role;
grant execute on function subscribe_email_address(text, text, text, text)
  to service_role;
