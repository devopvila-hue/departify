-- TikTok Login Kit and TikTok for Business OAuth use the existing
-- server-only external OAuth store. Only safe account metadata is persisted
-- outside the credential columns; RLS remains deny-by-default.
alter table public.external_oauth_tokens
  add column if not exists refresh_expires_at timestamptz,
  add column if not exists account_options jsonb not null default '[]'::jsonb,
  add column if not exists selected_account_ref text;

alter table public.external_oauth_tokens
  drop constraint if exists external_oauth_tokens_provider_check;

alter table public.external_oauth_tokens
  add constraint external_oauth_tokens_provider_check
  check (provider in ('meta_business', 'meta_instagram', 'ticktick', 'github', 'tiktok', 'tiktok_business'));

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
      'github_repository',
      'tiktok',
      'tiktok_ads'
    )
  );
