create or replace function apply_email_list_changes(
  p_remove_emails text[],
  p_restore_emails text[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_remove text[];
  v_restore text[];
  v_removed integer := 0;
  v_restored integer := 0;
begin
  select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into v_remove
  from unnest(coalesce(p_remove_emails, array[]::text[])) as value
  where trim(value) <> '';

  select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into v_restore
  from unnest(coalesce(p_restore_emails, array[]::text[])) as value
  where trim(value) <> '';

  if v_remove && v_restore then
    raise exception 'An email address cannot be removed and restored in the same change.';
  end if;

  insert into do_not_market (email, reason, source_message_id, unsubscribed_at)
  select value, 'manual_sheet', null, now()
  from unnest(v_remove) as value
  on conflict (email) do update
  set reason = excluded.reason,
      unsubscribed_at = excluded.unsubscribed_at;

  delete from email_signups
  where lower(trim(email)) = any(v_remove);
  get diagnostics v_removed = row_count;

  select coalesce(array_agg(d.email), array[]::text[])
    into v_restore
  from do_not_market d
  where d.email = any(v_restore);

  delete from email_signups
  where lower(trim(email)) = any(v_restore);

  delete from do_not_market
  where email = any(v_restore);

  insert into email_signups (email, source)
  select value, 'admin_restore'
  from unnest(v_restore) as value;
  get diagnostics v_restored = row_count;

  return jsonb_build_object(
    'removed_count', v_removed,
    'restored_count', v_restored
  );
end;
$$;

revoke execute on function apply_email_list_changes(text[], text[])
  from public, anon, authenticated;
grant execute on function apply_email_list_changes(text[], text[])
  to service_role;
