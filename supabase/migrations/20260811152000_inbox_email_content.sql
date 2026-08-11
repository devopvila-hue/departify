-- Customer Zero P0.2 — retain normalized email content for the unified Inbox
-- read view. Additive only; existing Inbox rows remain readable.

alter table public.inbox_items
  add column if not exists cc jsonb not null default '[]'::jsonb,
  add column if not exists html_body text,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists mailbox text,
  add column if not exists folder text;
