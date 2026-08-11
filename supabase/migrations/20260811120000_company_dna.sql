-- Customer Zero P0 — durable Company DNA.
--
-- THE DEFECT THIS REPAIRS
--
-- Until now the entire Customer Zero company understanding (intake,
-- research output, discovery answers, CEO confirmation, provisioning)
-- lived ONLY in a process-local `Map` inside the backend. Nothing was
-- persisted. A backend restart erased the company; the readiness gate
-- was evaluated against memory that could not survive a deploy; and the
-- operational context handed to the department could never be
-- reconstructed from durable facts.
--
-- This table is the canonical, durable Company DNA: the minimum set of
-- business facts Departify must know before it may start working for a
-- company, plus the readiness milestones that prove HOW those facts were
-- established.
--
-- ONE ROW PER ORGANIZATION. Facts and milestones live together on
-- purpose: the readiness gate stays simple (five facts, not thirty
-- booleans) and cannot drift from the data it describes.
--
-- BOUNDARIES (deliberate, enforced in application code):
--   * Company DNA holds durable BUSINESS facts only.
--   * It is NEVER a dumping ground for email bodies, documents, chat
--     transcripts, credentials, OAuth tokens or secrets. Conversation
--     history stays in `conversations`; department memory stays in
--     department memory; credentials never leave the credential layer.
--   * `declared_tools` records what the CEO SAYS the company uses. It is
--     a business fact, NOT a connection. Real connection health lives in
--     `organization_tool_states` and is never inferred from here.
--
-- STALE-CONFIRMATION RULE:
--   `facts_updated_at` moves every time the canonical business facts
--   change. A confirmation is only valid while
--   `ceo_confirmed_at >= facts_updated_at`. Correcting the company after
--   confirming therefore INVALIDATES the confirmation, which is exactly
--   what "the CEO confirmed the company we actually stored" means.
--
-- Additive and backward compatible: `create table if not exists`, no
-- destructive change to any existing table, no data deletion.

create table if not exists public.company_dna (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,

  -- Basic intake (STEP 1).
  company_name text not null,
  website text,
  description text,
  country text,
  company_size text,
  objective text,

  -- Business understanding (STEP 3) — grounded in real research or in
  -- the CEO's own description. Empty means "not known", never "assumed".
  products jsonb not null default '[]'::jsonb,
  customers jsonb not null default '[]'::jsonb,
  geography text,
  business_model text,
  positioning text,
  channels jsonb not null default '[]'::jsonb,

  -- Tooling the CEO DECLARED (not connection state — see boundaries).
  declared_tools jsonb not null default '[]'::jsonb,

  -- What Departify honestly does NOT know yet.
  uncertainties jsonb not null default '[]'::jsonb,

  -- Where each fact came from: 'research' | 'ceo' | 'inferred'.
  provenance jsonb not null default '{}'::jsonb,

  -- Readiness milestones — durable proof, not frontend progress.
  research_completed_at timestamptz,
  blocking_discovery_completed_at timestamptz,
  ceo_confirmed_at timestamptz,
  department_provisioned_at timestamptz,

  -- Moves whenever canonical facts change; invalidates a stale
  -- confirmation (see STALE-CONFIRMATION RULE above).
  facts_updated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_dna_organization_id_idx
  on public.company_dna (organization_id);

alter table public.company_dna enable row level security;

-- An authenticated member of the organization may read its own DNA.
-- Writes are service_role only (the backend owns the canonical record).
create policy company_dna_select_own
  on public.company_dna
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = public.company_dna.organization_id
        and membership.user_id = auth.uid()
    )
  );

grant select on public.company_dna to authenticated;
grant select, insert, update, delete on public.company_dna to service_role;
