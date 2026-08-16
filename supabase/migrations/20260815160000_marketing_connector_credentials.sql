-- Tenant-scoped WordPress/Shopify credentials. This table is backend
-- service-role only; portal, OpenClaw, and client roles must never read it.
create table if not exists public.marketing_connector_credentials (
  organization_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('wordpress', 'shopify')),
  credentials jsonb not null,
  account_label text not null,
  verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, provider)
);

alter table public.marketing_connector_credentials enable row level security;

comment on table public.marketing_connector_credentials is
  'Service-role-only credential vault for tenant marketing connectors; never expose credentials to clients or model contexts.';
