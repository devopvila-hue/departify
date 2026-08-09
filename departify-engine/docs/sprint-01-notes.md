# Departify Engine — Sprint 01 notes

Recorded observations for SPRINT ENGINE 01. This is the operator log of what
was actually built and tested; see README.md for the operator runbook.

## Provider change (mid-sprint)

Sprint 01 originally used local Ollama (qwen3). Ollama on this Apple Silicon
host ran CPU-only, took 40-180s per turn, and intermittently timed out the
agent. Per the continuation directive, the default provider was switched to
**Google Vertex AI** (`google-vertex`, `gemini-2.5-flash`, project
`radar-503418`, region `us-central1`) using **Application Default Credentials**.
Ollama is retained as the optional local fallback.

## What was verified (all real, no mocks)

| Test | Result |
| ---- | ------ |
| `/healthz` liveness | 200 `{"ok":true,"status":"live"}` |
| `/readyz` readiness | 200 `{"ready":true}` |
| Gateway process | alive |
| `DEPARTIFY_VERTEX_OK` | `gemini-2.5-flash` via `google-vertex`, ~3-6s |
| Context (NEBULA-4729) | recalled across turns in same session |
| Session listing | `openclaw sessions --json` lists persisted sessions |
| History | trajectory export: 21 events / 7 transcript events |
| Usage | per-session `inputTokens/outputTokens/totalTokens/model` |
| Tool loop | real `exec` call → result (toolCalls=1, tools=exec) |
| Restart | container restart → ready, sessions persisted |
| Observability | health surface intact; OTEL export is env-driven |

## Latency (Vertex, gemini-2.5-flash)

- First call after warm-up: ~3-6s.
- Same-session follow-up with context cache: ~1.5-8s.
- Contrast: qwen3:0.6b on local Ollama (CPU) took 40-180s.

## Known transient: Vertex 429

During a batch of rapid sequential tests the project hit Vertex
`429 RESOURCE_EXHAUSTED` once; OpenClaw correctly failed over to the Ollama
fallback, which was too slow for the 90-120s test window and caused a timeout.
Re-running with Vertex resumed normal operation. Mitigations in place:
`models.providers.google-vertex.timeoutSeconds: 300` and a faster model. No
code path depends on the 429; treat it as quota pressure during burst testing.

## Authentication (local vs Railway)

- **Local:** host ADC file mounted read-only into the container at
  `/home/node/.config/gcloud/application_default_credentials.json`. The bundled
  `google` plugin reads it via `GOOGLE_APPLICATION_CREDENTIALS` (already set in
  compose). No OAuth tokens in `.env`; the file never enters the image.
- **Railway (prepared, not wired):** no host ADC exists. Intended path is a
  service-account key JSON supplied via `GOOGLE_APPLICATION_CREDENTIALS`
  (Railway secret mounted as a file), or Workload Identity Federation on
  GCE/GKE. Requires outbound HTTPS to `oauth2.googleapis.com` and
  `us-central1-aiplatform.googleapis.com`. Decision deferred to a later sprint.

## Persistence

| Path | Content | Persists across restart |
| ---- | ------- | ----------------------- |
| `/home/node/.openclaw` (volume) | openclaw.json, engine.json, sessions/ (JSONL + trajectory), agents/, state/ | Yes |
| `/home/node/.config/openclaw` (volume) | auth-profile encryption key | Yes |
| `/tmp/openclaw/` (ephemeral) | rolling gateway logs | No (recreated) |

Railway must mount a volume at `/home/node/.openclaw` and a second at
`/home/node/.config/openclaw`.

## Tool policy

`tools.profile: "messaging"` + `alsoAllow: ["exec"]` when
`OPENCLAW_EXEC_MODE=test`, bounded to safe bins (`date`, `echo`, `pwd`, `env`,
`ls`, `cat`, `uname`); `write`, `edit`, `apply_patch`, `web_search`,
`web_fetch`, `browser`, `gateway`, `cron` denied; filesystem workspace-only.
Production default should be `OPENCLAW_EXEC_MODE=locked` until the adapter
sprint defines the exact tool contract.
