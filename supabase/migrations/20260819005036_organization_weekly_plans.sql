-- Operating Loop — weekly plan persistence.
--
-- A WeeklyPlan is the durable bridge between "Chat → Plan" and
-- "Plan → DepartmentTask". When the CEO accepts a plan, each item is
-- materialized as a real DepartmentTask row with `plannedDate` set and
-- a `weekly_plan` source so the calendar projection picks it up.
--
-- Tenant isolation: only members of the org can read; the backend
-- writes via the service role (RLS bypass).

create table if not exists public.organization_weekly_plans (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  week_start_iso timestamptz not null,
  objective text not null check (length(objective) > 0),
  items jsonb not null default '[]'::jsonb,
  status text not null check (status in ('draft', 'accepted')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index organization_weekly_plans_org_week_idx
  on public.organization_weekly_plans (organization_id, week_start_iso desc);

alter table public.organization_weekly_plans enable row level security;

create policy organization_weekly_plans_select_member
  on public.organization_weekly_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.organization_weekly_plans.organization_id
        and membership.user_id = auth.uid()
    )
  );

grant select on public.organization_weekly_plans to authenticated;
grant select, insert, update, delete on public.organization_weekly_plans to service_role;
