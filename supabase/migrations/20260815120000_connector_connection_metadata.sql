-- Safe, tenant-scoped connection metadata for first-party advertising connectors.
-- No credential values are stored here. Provider account references must be
-- opaque labels/IDs, and last_error is a sanitized application message.

alter table public.organization_tool_states
  add column if not exists connection_provider text,
  add column if not exists provider_account_ref text,
  add column if not exists granted_capabilities jsonb,
  add column if not exists granted_scopes jsonb,
  add column if not exists last_validated_at timestamptz,
  add column if not exists last_error text;
