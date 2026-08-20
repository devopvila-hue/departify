-- Sprint 67 P0.8 — Durable Founder Runs
-- Decouples OpenClaw execution from HTTP request lifecycle.
-- A FounderRun persists independently; the portal polls or streams.

CREATE TABLE IF NOT EXISTS founder_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id       UUID NOT NULL,
  session_key   TEXT NOT NULL,            -- e.g. "founder-development:{org}:{user}"
  openclaw_session_id TEXT,               -- OpenClaw session ID once assigned

  -- Lifecycle
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','completed','failed','cancelled')),
  input         TEXT NOT NULL,            -- the founder's message

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,

  -- Progress
  tool_call_count INT NOT NULL DEFAULT 0,
  current_step  TEXT,                     -- human-readable step description

  -- Result
  final_text    TEXT,                     -- persisted assistant response
  error_code    TEXT,                     -- structured error code
  error_message TEXT,                     -- human-readable error

  -- Metadata (no secrets)
  metadata      JSONB DEFAULT '{}'::jsonb
);

-- Index: find active run for a session (only one allowed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_runs_active_session
  ON founder_runs (session_key)
  WHERE status IN ('queued', 'running');

-- Index: list recent runs for an org
CREATE INDEX IF NOT EXISTS idx_founder_runs_org_created
  ON founder_runs (organization_id, created_at DESC);

-- Index: find runs by user
CREATE INDEX IF NOT EXISTS idx_founder_runs_user
  ON founder_runs (user_id, created_at DESC);


-- Sprint 67 P0.8 — Founder Run Events
-- Persisted event stream for a run. Portal replays on reconnect.

CREATE TABLE IF NOT EXISTS founder_run_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES founder_runs(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,              -- run.started, tool.started, tool.completed, etc.
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_founder_run_events_run_seq
  ON founder_run_events (run_id, id);

-- RLS: org members can read their own runs
ALTER TABLE founder_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_run_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY founder_runs_org_read ON founder_runs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY founder_run_events_org_read ON founder_run_events
  FOR SELECT USING (
    run_id IN (
      SELECT id FROM founder_runs
      WHERE organization_id IN (
        SELECT organization_id FROM organization_memberships
        WHERE user_id = auth.uid()
      )
    )
  );

-- Service role can do everything (for backend writes)
CREATE POLICY founder_runs_service_all ON founder_runs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY founder_run_events_service_all ON founder_run_events
  FOR ALL USING (auth.role() = 'service_role');
