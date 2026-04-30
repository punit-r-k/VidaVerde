begin;

create extension if not exists "pgcrypto";

create table if not exists email_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('order_confirmation')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  order_id uuid references orders(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_jobs_status_available_idx
  on email_jobs (status, available_at, created_at);

create index if not exists email_jobs_order_type_idx
  on email_jobs (order_id, type);

create unique index if not exists email_jobs_order_confirmation_active_idx
  on email_jobs (order_id, type)
  where type = 'order_confirmation'
    and status in ('pending', 'processing', 'failed');

drop trigger if exists set_email_jobs_updated_at on email_jobs;
create trigger set_email_jobs_updated_at
before update on email_jobs
for each row execute function set_updated_at();

alter table public.email_jobs enable row level security;

do $$
declare
  v_policy text;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'email_jobs'
  loop
    execute format('drop policy if exists %I on public.email_jobs', v_policy);
  end loop;
end $$;

revoke all on table public.email_jobs from public, anon, authenticated;
grant all on table public.email_jobs to service_role;

commit;
