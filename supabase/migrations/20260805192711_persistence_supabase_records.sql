create table if not exists public.departify_organization_records (
  id text primary key,
  snapshot jsonb not null,
  version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departify_workspace_records (
  id text primary key,
  snapshot jsonb not null,
  version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departify_provisioning_records (
  id text primary key,
  snapshot jsonb not null,
  version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.departify_organization_records enable row level security;
alter table public.departify_workspace_records enable row level security;
alter table public.departify_provisioning_records enable row level security;

grant select, insert, update, delete on table public.departify_organization_records to service_role;
grant select, insert, update, delete on table public.departify_workspace_records to service_role;
grant select, insert, update, delete on table public.departify_provisioning_records to service_role;
