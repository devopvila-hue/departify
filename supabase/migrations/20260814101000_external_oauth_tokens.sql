-- Server-only OAuth tokens for Meta Business and TickTick.
-- Raw tokens never reach authenticated clients, OpenClaw, or logs.
create table if not exists public.external_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('meta_business', 'ticktick')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  account_label text,
  operational_verified_at timestamptz,
  operational_probe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, provider)
);

create index if not exists external_oauth_tokens_org_idx
  on public.external_oauth_tokens (organization_id, provider);

alter table public.external_oauth_tokens enable row level security;

create policy external_oauth_tokens_block_all on public.external_oauth_tokens
  for all to authenticated using (false);

grant select, insert, update, delete on public.external_oauth_tokens to service_role;
