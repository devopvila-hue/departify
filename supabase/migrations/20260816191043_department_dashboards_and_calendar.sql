-- Reusable dashboard definitions for every department. The dashboard is a
-- controlled projection: the backend accepts only the widget kinds defined
-- by Departify and the organization owns every row.

create table if not exists public.department_dashboards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null,
  title text not null,
  description text not null default '',
  date_range jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '[]'::jsonb,
  widgets jsonb not null default '[]'::jsonb,
  filters jsonb not null default '[]'::jsonb,
  data_sources jsonb not null default '[]'::jsonb,
  layout jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists department_dashboards_org_idx
  on public.department_dashboards (organization_id, status, updated_at desc);

-- The product limit must hold even when two backend requests race. The
-- transaction lock serializes inserts per organization before counting active
-- definitions. Archived dashboards free a slot.
create or replace function public.enforce_department_dashboard_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  if NEW.status = 'active' then
    perform pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 0));
    select count(*) into active_count
      from public.department_dashboards
      where organization_id = NEW.organization_id
        and status = 'active'
        and id <> coalesce(NEW.id, gen_random_uuid());
    if active_count >= 5 then
      raise exception using
        errcode = 'P0001',
        message = 'dashboard_limit';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists department_dashboards_limit on public.department_dashboards;
create trigger department_dashboards_limit
  before insert or update of organization_id, status
  on public.department_dashboards
  for each row execute function public.enforce_department_dashboard_limit();

alter table public.department_dashboards enable row level security;

create policy department_dashboards_select_own on public.department_dashboards
  for select to authenticated using (exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = public.department_dashboards.organization_id
      and membership.user_id = auth.uid()
  ));

grant select on public.department_dashboards to authenticated;
grant select, insert, update, delete on public.department_dashboards to service_role;
