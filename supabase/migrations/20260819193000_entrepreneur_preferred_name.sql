-- Sprint 67 P0.1-A — Personal identity.
--
-- Departify must know how to call the entrepreneur without ever calling
-- them "CEO". There is no canonical name source anywhere in the product
-- (auth exposes id + email; onboarding captures company fields, not
-- person fields), so the Company DNA row carries two person fields.
--
--   entrepreneur_preferred_name   how the entrepreneur wants to be called,
--                                 captured once by the chat.
--   entrepreneur_name_requested_at when Departify used its ONE chance to
--                                 ask. Bounds the ask to at most once,
--                                 durably, across reloads/conversations.
--
-- These are NOT business facts: application code writes them WITHOUT
-- moving `facts_updated_at`, so storing a name never invalidates a CEO
-- confirmation. Nullable, additive, no backfill needed.

ALTER TABLE public.company_dna
  ADD COLUMN IF NOT EXISTS entrepreneur_preferred_name text;

ALTER TABLE public.company_dna
  ADD COLUMN IF NOT EXISTS entrepreneur_name_requested_at timestamptz;
