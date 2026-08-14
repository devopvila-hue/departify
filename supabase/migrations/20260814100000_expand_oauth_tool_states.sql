-- OAuth state is shared by every provider-specific callback. The original
-- constraint predated YouTube and the Marketing providers, which meant a
-- valid YouTube state could be rejected by Supabase before the callback.
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
      'ticktick'
    )
  );
