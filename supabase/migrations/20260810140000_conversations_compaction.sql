-- Phase P-B (part 15+26) — conversation summary + compaction trace.
--
-- The chat history is preserved verbatim in public.conversation_messages.
-- A compaction summary is stored on the conversation row so the model can
-- retrieve the older semantic context without re-reading every message.
-- Compaction never deletes raw history.

alter table public.conversations
  add column if not exists summary text,
  add column if not exists compacted_at timestamptz,
  add column if not exists compacted_up_to_message_id uuid
    references public.conversation_messages (id) on delete set null,
  add column if not exists compaction_message_count integer;
