-- Facebook Pages and Instagram Login use separate Meta OAuth providers while
-- sharing the same tenant-facing Meta Social connection and callback URL.
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
      'ticktick'
    )
  );

alter table public.external_oauth_tokens
  drop constraint if exists external_oauth_tokens_provider_check;

alter table public.external_oauth_tokens
  add constraint external_oauth_tokens_provider_check
  check (provider in ('meta_business', 'meta_instagram', 'ticktick'));
