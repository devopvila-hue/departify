-- Customer Zero 03 — durable unified inbox.
--
-- Persists normalized InboxItems (non-secret business data) org-scoped so the
-- inbox survives backend restarts/redeploys. Follows the Phase P-B pattern
-- (conversations, marketing durable state): RLS via organization_memberships,
-- service_role for the backend.
--
-- SECURITY NOTE (CZ03): Google OAuth tokens are NOT stored here. Refresh
-- tokens remain in the in-process gmailTokenStore. Persisting encrypted tokens
-- at rest requires a production encryption mechanism which the current
-- architecture does not have; the brief forbids inventing insecure crypto and
-- requires documenting that blocker explicitly. See the CZ03 final report.

create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null,
  source_message_id text not null,
  source_thread_id text,
  channel text not null default 'email',
  category text not null default 'unknown'
    check (category in ('lead', 'customer_question', 'campaign_response', 'support', 'administrative', 'unknown')),
  subject text not null default '',
  sender_email text not null default '',
  sender_name text,
  recipients jsonb not null default '[]'::jsonb,
  plain_text text not null default '',
  preview text not null default '',
  received_at timestamptz not null,
  unread boolean not null default false,
  importance numeric not null default 0 check (importance >= 0 and importance <= 1),
  department_id text,
  is_lead boolean not null default false,
  related_work_item_id text,
  related_conversation_id text,
  provenance jsonb not null default '{}'::jsonb,
  state text not null default 'received'
    check (state in ('received', 'classified', 'routed', 'in_work', 'resolved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, source_message_id)
);

create index inbox_items_org_idx
  on public.inbox_items (organization_id, received_at desc);

create index inbox_items_category_idx
  on public.inbox_items (organization_id, category);

-- Row Level Security -------------------------------------------------------

alter table public.inbox_items enable row level security;

create policy inbox_items_select_own on public.inbox_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.inbox_items.organization_id
        and membership.user_id = auth.uid()
    )
  );

-- Grants -------------------------------------------------------------------

grant select on public.inbox_items to authenticated;
grant select, insert, update, delete on public.inbox_items to service_role;
