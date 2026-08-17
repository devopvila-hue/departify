-- Extend the existing DepartmentTask state machine for user-visible work
-- acknowledgements. This remains the existing durable work model.
alter table public.department_tasks
  drop constraint if exists department_tasks_status_check;

alter table public.department_tasks
  add constraint department_tasks_status_check
  check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'));

create unique index if not exists department_tasks_chat_operation_idx
  on public.department_tasks (organization_id, (source->>'operationKey'))
  where source->>'type' = 'chat_operation';
