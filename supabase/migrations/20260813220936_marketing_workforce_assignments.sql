alter table public.department_tasks
  add column if not exists assigned_employee_id text;

create table if not exists public.department_employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id text not null,
  employee_id text not null,
  label text not null,
  role text not null,
  capabilities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, department_id, employee_id)
);

alter table public.department_employees enable row level security;

drop policy if exists department_employees_select_member on public.department_employees;
create policy department_employees_select_member
  on public.department_employees for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = department_employees.organization_id
      and m.user_id = auth.uid()
  ));

grant select on public.department_employees to authenticated;
grant all on public.department_employees to service_role;

create table if not exists public.department_memory (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id text not null,
  kind text not null,
  title text not null,
  content text not null,
  provenance text not null,
  source text,
  importance numeric not null default 0.5,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.department_memory enable row level security;
drop policy if exists department_memory_select_member on public.department_memory;
create policy department_memory_select_member
  on public.department_memory for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = department_memory.organization_id
      and m.user_id = auth.uid()
  ));
grant select on public.department_memory to authenticated;
grant all on public.department_memory to service_role;

insert into public.department_employees
  (organization_id, department_id, employee_id, label, role, capabilities)
select dna.organization_id, 'marketing', roster.employee_id, roster.label,
       roster.role, roster.capabilities::jsonb
from public.company_dna dna
cross join (values
  ('agent_content_strategist', 'Especialista en Contenido', 'Creación de contenido', '["content_creation","content_strategy","positioning_strategy"]'),
  ('agent_social_media_manager', 'Especialista en Redes Sociales', 'Redes sociales', '["social_media","content_creation"]'),
  ('agent_ads_specialist', 'Especialista en Publicidad', 'Publicidad y adquisición', '["advertising_paid","campaign_strategy"]')
) as roster(employee_id, label, role, capabilities)
where dna.department_provisioned_at is not null
on conflict (organization_id, department_id, employee_id) do nothing;
