-- Sprint 68.1 — safe, resumable approval-gated conversational operations.
-- Credentials remain in their existing secure stores; payload contains only
-- the business data needed to recover a draft/proposal after a restart.
create table if not exists public.conversation_pending_work (
  operation_id text not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  type text not null check (type in ('email', 'calendar', 'facebook_pages')),
  status text not null check (status in ('active', 'executing', 'failed', 'succeeded', 'cancelled', 'ambiguous')),
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, conversation_id, type)
);

create index if not exists conversation_pending_work_active_idx
  on public.conversation_pending_work (organization_id, conversation_id, updated_at desc)
  where status in ('active', 'executing', 'failed', 'ambiguous');

alter table public.conversation_pending_work enable row level security;
create policy conversation_pending_work_select_own on public.conversation_pending_work
  for select to authenticated using (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = conversation_pending_work.organization_id
        and membership.user_id = auth.uid()
    )
  );

grant select on public.conversation_pending_work to authenticated;
grant select, insert, update, delete on public.conversation_pending_work to service_role;
