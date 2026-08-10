-- Customer Zero Email P0 — corporate email accounts (IMAP + SMTP).
--
-- "Otro correo de empresa" is the non-Google email provider. Credentials
-- are server-only, org+user scoped, never returned to the portal, never
-- placed in Company DNA / chat history / logs.
--
-- Security contract mirrors google_oauth_tokens:
--   - service-role only; RLS blocks authenticated roles entirely.
--   - `password` (app password) is stored server-side in the same
--     posture as Google refresh tokens (not exposed, not logged).
--   - The `operational_verified_at` / `operational_probe_error` columns
--     gate "connected": a connection is operational only after a real
--     bounded IMAP + SMTP probe succeeds.

create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  provider text not null default 'imap_smtp' check (provider in ('imap_smtp')),
  email text not null,
  username text not null,
  password text not null,
  imap_host text not null,
  imap_port integer not null default 993,
  imap_secure boolean not null default true,
  smtp_host text not null,
  smtp_port integer not null default 587,
  smtp_secure boolean not null default true,
  display_name text,
  operational_verified_at timestamptz,
  operational_probe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, provider)
);

create index email_accounts_org_user_idx on public.email_accounts (organization_id, user_id);

alter table public.email_accounts enable row level security;

create policy email_accounts_block_all on public.email_accounts
  for all
  to authenticated
  using (false);

grant select, insert, update, delete on public.email_accounts to service_role;
