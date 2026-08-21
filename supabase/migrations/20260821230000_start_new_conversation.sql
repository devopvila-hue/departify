-- Chat Liberation: one active CEO thread, with atomic rollover for /new.
-- Company DNA, department memory, work and results live outside this table
-- and are therefore intentionally unaffected.
create or replace function public.start_new_conversation(
  target_organization_id uuid,
  conversation_title text default 'Nueva conversación'
)
returns setof public.conversations
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize rollovers across backend instances for this organization.
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text, 0));

  update public.conversations
  set status = 'archived', updated_at = now()
  where organization_id = target_organization_id
    and status = 'active';

  return query
    insert into public.conversations (organization_id, title, status)
    values (target_organization_id, conversation_title, 'active')
    returning *;
end;
$$;

revoke all on function public.start_new_conversation(uuid, text) from public;
grant execute on function public.start_new_conversation(uuid, text) to service_role;
