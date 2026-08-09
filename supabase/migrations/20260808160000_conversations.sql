-- Phase P-B (part 15) — durable organization-scoped conversations.
--
-- CEO chat history is SEPARATE from company memory: archiving or starting a
-- new conversation MUST NOT touch organizations, DNA, tool declarations,
-- connections, departments, tasks or approvals. Conversations belong to
-- exactly one organization.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create index conversations_org_status_idx
  on public.conversations (organization_id, status, last_message_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index conversation_messages_conversation_idx
  on public.conversation_messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create policy conversations_select_own on public.conversations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.conversations.organization_id
        and membership.user_id = auth.uid()
    )
  );

create policy conversation_messages_select_own on public.conversation_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations conversation
      where conversation.id = public.conversation_messages.conversation_id
        and exists (
          select 1
          from public.organization_memberships membership
          where membership.organization_id = conversation.organization_id
            and membership.user_id = auth.uid()
        )
    )
  );

grant select on public.conversations to authenticated;
grant select on public.conversation_messages to authenticated;
grant select, insert, update, delete on public.conversations to service_role;
grant select, insert, update, delete on public.conversation_messages to service_role;
