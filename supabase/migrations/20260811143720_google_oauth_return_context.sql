-- Preserve which bounded Google capability initiated the shared OAuth flow.
-- This is routing context only; no credentials or authorization codes are stored.
alter table public.oauth_state
  add column if not exists requested_tool_id text;

alter table public.oauth_state
  add constraint oauth_state_requested_tool_id_check
  check (requested_tool_id is null or requested_tool_id in ('gmail', 'google_workspace', 'google_calendar', 'google_drive'));
