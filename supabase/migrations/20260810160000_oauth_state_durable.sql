-- Phase P-B — durable OAuth state (CSRF / replay / org+user binding).
--
-- The OAuth `state` nonce binds a Google authorization attempt to its
-- (organization, user, intent, returnPath). In Railway the backend may
-- run several replicas and instances restart on every deploy: an
-- in-memory state store silently breaks the handshake between the
-- `connect` request and the `callback` request (nonce not found →
-- invalid_state → the CEO sees "not connected" and loops). The state
-- MUST survive across processes, so it lives here, server-only.
--
-- Server-only: the portal and the model never read this table. The
-- nonce itself is a random opaque value; the row only carries the
-- org/user binding and an expiry. RLS blocks every authenticated role;
-- the application talks to it exclusively through the service role.

create table if not exists public.oauth_state (
  nonce text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  connection_intent text not null default 'marketing',
  return_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed boolean not null default false
);

create index oauth_state_org_idx on public.oauth_state (organization_id);

alter table public.oauth_state enable row level security;

create policy oauth_state_block_all on public.oauth_state
  for all
  to authenticated
  using (false);

grant select, insert, update, delete on public.oauth_state to service_role;
