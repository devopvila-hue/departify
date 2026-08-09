-- Phase P-B — durable organization-scoped tool/connection state.
--
-- One authoritative record per (organization, tool). Stores references and
-- lifecycle status only — NEVER credential values. The Customer Zero
-- bootstrap is recorded as config_source = 'env:mautic' (Railway env), not as
-- a secret.
--
-- Status lifecycle (never invented, always derived from real facts):
--   selected | needs_connection | configured | connected | degraded | unavailable
-- CONNECTED requires a successful connector verification (verified_at set).

create table if not exists public.organization_tool_states (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tool_id text not null,
  status text not null
    check (status in ('selected', 'needs_connection', 'configured', 'connected', 'degraded', 'unavailable')),
  declared boolean not null default false,
  label text not null,
  capability text,
  config_source text,
  verified_at timestamptz,
  health text check (health in ('operational', 'degraded', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, tool_id)
);

create index organization_tool_states_organization_id_idx
  on public.organization_tool_states (organization_id);

alter table public.organization_tool_states enable row level security;

-- An authenticated member of the organization may read its tool states.
create policy organization_tool_states_select_own
  on public.organization_tool_states
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.organization_tool_states.organization_id
        and membership.user_id = auth.uid()
    )
  );

grant select on public.organization_tool_states to authenticated;
grant select, insert, update, delete on public.organization_tool_states to service_role;
