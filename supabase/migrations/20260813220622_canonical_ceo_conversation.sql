-- One durable CEO thread per organization. Existing threads are preserved as
-- archived history; only the newest active thread becomes canonical.
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id
      order by coalesce(last_message_at, created_at) desc, created_at desc, id desc
    ) as rn
  from public.conversations
  where status = 'active'
)
update public.conversations c
set status = 'archived', updated_at = now()
from ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists conversations_one_active_per_org_idx
  on public.conversations (organization_id)
  where status = 'active';
