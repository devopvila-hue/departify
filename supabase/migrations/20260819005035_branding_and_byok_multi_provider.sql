-- Phase P-B Sprint 60 — real branding + multi-provider BYOK.
--
-- 1. organization_llm_credentials: extend the provider check to include the
--    second operational provider (MiniMax — OpenAI-compatible endpoint) and
--    persist an optional base URL for OpenAI-compatible tenants that point
--    elsewhere (the local OpenClaw gateway in development, or any compatible
--    customer endpoint in production).
--
-- 2. organization_branding: a tiny per-organization table that stores a
--    durable reference to the logo asset path in Supabase Storage. The DB
--    does NOT store a signed URL — that is generated server-side on read.
--
-- 3. organization-assets bucket: private storage bucket holding
--    organizations/<organizationId>/branding/logo.<ext>. RLS on storage
--    objects blocks cross-tenant reads/writes; the backend uses the service
--    role to upload/delete and to mint signed URLs for the portal.

-- 1. Extend BYOK credentials ----------------------------------------------------

alter table public.organization_llm_credentials
  drop constraint if exists organization_llm_credentials_provider_check;

alter table public.organization_llm_credentials
  add constraint organization_llm_credentials_provider_check
  check (provider in ('openai', 'minimax'));

alter table public.organization_llm_credentials
  add column if not exists base_url text;

alter table public.organization_llm_credentials
  drop constraint if exists organization_llm_credentials_base_url_check;

alter table public.organization_llm_credentials
  add constraint organization_llm_credentials_base_url_check
  check (base_url is null or (length(base_url) > 0 and base_url ~ '^https?://'));

-- 2. Organization branding -------------------------------------------------------

create table if not exists public.organization_branding (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- Durable storage path inside the organization-assets bucket:
  --   organizations/<organizationId>/branding/logo.<ext>
  logo_asset_path text,
  logo_mime_type text,
  logo_size_bytes integer check (logo_size_bytes is null or logo_size_bytes > 0),
  brand_name text check (brand_name is null or length(brand_name) <= 80),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.organization_branding enable row level security;

create policy organization_branding_select_member on public.organization_branding
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.organization_branding.organization_id
        and membership.user_id = auth.uid()
    )
  );

-- Writes happen through the backend service role; the portal never
-- touches this table directly. Service-role writes bypass RLS.
grant select on public.organization_branding to authenticated;
grant select, insert, update, delete on public.organization_branding to service_role;

-- 3. organization-assets storage bucket (private) ---------------------------------
--
-- We create the bucket via the storage admin schema, which works on every
-- Supabase project that exposes the storage extension. The bucket is
-- private (public = false) so the only way to read an asset is through a
-- signed URL minted by the service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-assets',
  'organization-assets',
  false,
  5 * 1024 * 1024, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Tenant isolation policies for storage.objects scoped to this bucket.
-- Service-role uploads/downloads bypass these policies; authenticated
-- users can only read their own org's logo (defense in depth — the
-- backend serves signed URLs anyway).
drop policy if exists organization_assets_read_own on storage.objects;
create policy organization_assets_read_own on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'organization-assets'
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.user_id = auth.uid()
        and storage.objects.name like 'organizations/' || membership.organization_id::text || '/%'
    )
  );
