-- Phase P-B — durable Google OAuth refresh tokens (gmail + workspace + calendar + drive).
--
-- A connected Google identity MUST survive Railway backend restarts.
-- Tokens are server-only, org+user scoped, never returned to the portal,
-- never placed in Company DNA / chat history / logs.
--
-- Tokens are server-only; the CEO never sees them. The `scopes` array
-- records the scopes ACTUALLY GRANTED by Google (not requested) — they
-- gate the capability surface (email.search only available when
-- gmail.readonly is granted, etc.).

create table if not exists public.google_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('gmail', 'google_workspace', 'google_calendar', 'google_drive')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scopes text[] not null default '{}',
  email text not null,
  display_name text,
  -- The connection identity persists the latest granted scope set and
  -- an operational probe timestamp. We do NOT persist client_id or
  -- client_secret on this row because those are env-only.
  operational_verified_at timestamptz,
  operational_probe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, provider)
);

create index google_oauth_tokens_org_user_idx
  on public.google_oauth_tokens (organization_id, user_id);

-- Only one row per (org, user, provider). We always upsert on
-- (org, user, provider).
alter table public.google_oauth_tokens enable row level security;

-- Defence-in-depth RLS: the service role bypasses RLS, so application
-- paths go through service_role. Authenticated users have NO direct
-- access — they read their own data only via API endpoints that hide
-- the token values.
create policy google_oauth_tokens_block_all on public.google_oauth_tokens
  for all
  to authenticated
  using (false);

grant select, insert, update, delete on public.google_oauth_tokens to service_role;
