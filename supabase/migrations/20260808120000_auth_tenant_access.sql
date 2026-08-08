-- Phase P0-A — real identity + tenant access control.
--
-- organizations + organization_memberships backed by Supabase Auth users.
--
-- Security model:
--   * RLS: an authenticated user can only SELECT organizations they belong to.
--   * Organization creation is ATOMIC through the security-definer function
--     public.create_organization (organization + owner membership in one
--     transaction). Only the service role may execute it; the backend calls
--     it with a server-side verified user id. The browser never calls it.
--   * Service-role operations are backend-only and bypass RLS.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_id_idx
  on public.organization_memberships (user_id);

create index organization_memberships_organization_id_idx
  on public.organization_memberships (organization_id);

-- Row Level Security -------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

create policy organizations_select_own on public.organizations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.organizations.id
        and membership.user_id = auth.uid()
    )
  );

create policy memberships_select_own on public.organization_memberships
  for select
  to authenticated
  using (user_id = auth.uid());

-- Grants -------------------------------------------------------------------
-- authenticated: read through RLS only.
-- service_role: full backend access (bypasses RLS by role).

grant select on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.organizations to service_role;
grant select, insert, update, delete on public.organization_memberships to service_role;

-- Atomic organization creation ----------------------------------------------

create or replace function public.create_organization(
  p_name text,
  p_owner uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
begin
  if p_owner is null then
    raise exception 'organization owner is required';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'organization name is required';
  end if;

  -- Defense in depth: when a real user JWT is present it must match the
  -- owner. With a service-role call auth.uid() is null and this passes.
  if auth.uid() is not null and auth.uid() <> p_owner then
    raise exception 'cannot create an organization for another user';
  end if;

  insert into public.organizations (name, created_by)
  values (trim(p_name), p_owner)
  returning id into v_organization_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_organization_id, p_owner, 'owner');

  return v_organization_id;
end;
$$;

revoke all on function public.create_organization(text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_organization(text, uuid)
  to service_role;
