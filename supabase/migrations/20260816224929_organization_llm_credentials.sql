-- Organization-owned BYOK for the supported reasoning provider. This table
-- is deliberately service-role-only: the portal receives status metadata,
-- never the API key.
create table if not exists public.organization_llm_credentials (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('openai')),
  model text not null check (length(model) > 0),
  api_key text not null check (length(api_key) > 0),
  created_by uuid,
  verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider)
);

alter table public.organization_llm_credentials enable row level security;

comment on table public.organization_llm_credentials is
  'Service-role-only BYOK credential vault; never expose API keys to portal, logs, analytics, or model context.';
