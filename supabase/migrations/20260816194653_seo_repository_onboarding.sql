-- Durable SEO onboarding association. Repository credentials remain in the
-- existing server-only external_oauth_tokens store; this table stores only
-- the tenant-scoped project selection and capability boundary.

create table if not exists public.seo_repository_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id text not null default 'seo' check (department_id = 'seo'),
  website text not null,
  provider text not null default 'github' check (provider = 'github'),
  repository_id text not null,
  repository_full_name text not null,
  default_branch text not null default 'main',
  access text not null default 'read' check (access in ('read', 'write')),
  selected_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, department_id, website)
);

create index if not exists seo_repository_links_org_idx
  on public.seo_repository_links (organization_id, department_id);

alter table public.seo_repository_links enable row level security;

create policy seo_repository_links_select_own on public.seo_repository_links
  for select to authenticated using (exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = public.seo_repository_links.organization_id
      and membership.user_id = auth.uid()
  ));

grant select on public.seo_repository_links to authenticated;
grant select, insert, update, delete on public.seo_repository_links to service_role;

alter table public.external_oauth_tokens
  drop constraint if exists external_oauth_tokens_provider_check;

alter table public.external_oauth_tokens
  add constraint external_oauth_tokens_provider_check
  check (provider in ('meta_business', 'meta_instagram', 'ticktick', 'github'));

alter table public.oauth_state
  drop constraint if exists oauth_state_requested_tool_id_check;

alter table public.oauth_state
  add constraint oauth_state_requested_tool_id_check
  check (
    requested_tool_id is null or requested_tool_id in (
      'gmail',
      'google_workspace',
      'google_calendar',
      'google_drive',
      'youtube',
      'meta_business',
      'meta_instagram',
      'ticktick',
      'github_repository'
    )
  );
