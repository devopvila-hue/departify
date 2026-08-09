-- DEPLOY 01 — durable Marketing state (objectives, activity, approvals).
--
-- Follows the existing Phase P-B pattern (conversations):
--   * organization-scoped by construction;
--   * RLS via organization_memberships (authenticated: select own org rows);
--   * service_role: full backend access (bypasses RLS).
-- All tables reference public.organizations (id) on delete cascade.

create table if not exists public.marketing_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null default 'marketing',
  title text not null,
  description text not null default '',
  desired_outcome text not null default '',
  constraints jsonb not null default '[]'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  owner text not null default 'Elvira',
  created_by text not null default 'ceo',
  plan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_objectives_org_idx
  on public.marketing_objectives (organization_id, status, created_at desc);

create table if not exists public.marketing_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null default 'marketing',
  objective_id uuid references public.marketing_objectives (id) on delete set null,
  actor text not null default 'Elvira',
  type text not null check (type in (
    'objetivo_recibido',
    'plan_creado',
    'analisis_realizado',
    'campana_propuesta',
    'aprobacion_solicitada',
    'herramienta_utilizada',
    'resultado_generado',
    'objetivo_actualizado'
  )),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index marketing_activity_org_idx
  on public.marketing_activity (organization_id, created_at desc);

create table if not exists public.marketing_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null default 'marketing',
  objective_id uuid references public.marketing_objectives (id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  cost text,
  requested_by text not null default 'Elvira',
  decided_by text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index marketing_approvals_org_idx
  on public.marketing_approvals (organization_id, status, created_at desc);

-- Row Level Security -------------------------------------------------------

alter table public.marketing_objectives enable row level security;
alter table public.marketing_activity enable row level security;
alter table public.marketing_approvals enable row level security;

create policy marketing_objectives_select_own on public.marketing_objectives
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.marketing_objectives.organization_id
        and membership.user_id = auth.uid()
    )
  );

create policy marketing_activity_select_own on public.marketing_activity
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.marketing_activity.organization_id
        and membership.user_id = auth.uid()
    )
  );

create policy marketing_approvals_select_own on public.marketing_approvals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.marketing_approvals.organization_id
        and membership.user_id = auth.uid()
    )
  );

-- Grants -------------------------------------------------------------------
-- authenticated: read through RLS only.
-- service_role: full backend access (bypasses RLS by role).

grant select on public.marketing_objectives to authenticated;
grant select on public.marketing_activity to authenticated;
grant select on public.marketing_approvals to authenticated;
grant select, insert, update, delete on public.marketing_objectives to service_role;
grant select, insert, update, delete on public.marketing_activity to service_role;
grant select, insert, update, delete on public.marketing_approvals to service_role;
