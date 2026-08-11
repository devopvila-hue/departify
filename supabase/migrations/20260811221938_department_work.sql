-- Persist the existing DepartmentTask/DepartmentResult model used by /tareas
-- and the work executor. This is an adapter-backed continuation of the
-- existing work model, not a second task system.

create table if not exists public.department_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null,
  objective_id text,
  requested_by text not null,
  title text not null,
  summary text not null default '',
  capability text not null,
  tool_id text not null,
  status text not null check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed')),
  status_message text not null default '',
  progress numeric not null default 0 check (progress >= 0 and progress <= 1),
  required_capabilities jsonb not null default '[]'::jsonb,
  source jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result_id uuid,
  error_code text,
  error_message text,
  timeout_ms integer not null default 60000
);

create index if not exists department_tasks_org_idx
  on public.department_tasks (organization_id, created_at desc);

create unique index if not exists department_tasks_inbox_source_idx
  on public.department_tasks (organization_id, (source->>'inboxItemId'))
  where source->>'type' = 'inbox_email';

create table if not exists public.department_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null,
  related_work_item_id uuid,
  title text not null,
  summary text not null default '',
  content text not null default '',
  data jsonb,
  chart jsonb,
  source text not null default '',
  created_at timestamptz not null default now(),
  produced_by_capability text not null
);

create index if not exists department_results_org_idx
  on public.department_results (organization_id, created_at desc);

alter table public.department_tasks enable row level security;
alter table public.department_results enable row level security;

create policy department_tasks_select_own on public.department_tasks
  for select to authenticated using (exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = public.department_tasks.organization_id
      and membership.user_id = auth.uid()
  ));

create policy department_results_select_own on public.department_results
  for select to authenticated using (exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = public.department_results.organization_id
      and membership.user_id = auth.uid()
  ));

grant select on public.department_tasks to authenticated;
grant select on public.department_results to authenticated;
grant select, insert, update, delete on public.department_tasks to service_role;
grant select, insert, update, delete on public.department_results to service_role;
