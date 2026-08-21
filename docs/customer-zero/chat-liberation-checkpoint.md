# Chat Liberation checkpoint

Date: 2026-08-21
Status: implementation complete; real authenticated Customer Zero E2E blocked.

## Architecture closed

- One active conversation per organization; durable history owns the transcript.
- `/new` atomically archives/replaces the active thread and clears only conversation state.
- `/compact` and automatic overflow recovery share one canonical compactor.
- Every turn and lifecycle command uses the same per-organization queue.
- Stream failure recovers by durable read and never repeats the mutation.
- Runtime leak/failure recovery rotates the engine session while preserving any pre-executed capability result and its exactly-once exclusion.
- Legacy in-memory transcript is a bounded compatibility projection (20 messages), not routing authority.

## Verified gates

- Incident 01-06 + Conversation Reliability + Chat Liberation: 206/206.
- Backend full suite: 1307 passed, 4 skipped.
- Portal full suite: 146/146.
- Baseline at `e935f71`: backend 1297 passed/4 skipped; portal 144 passed. Current adds 10 backend and 2 portal passing tests.
- Backend and portal typecheck: pass.
- Backend build: pass.
- Portal build: pass with canonical public Supabase URL and a non-secret build placeholder; the unconfigured shell correctly rejects a production build.
- Backend lint baseline/current: 41/39 errors; no new lint debt. Portal lint: 0 errors, 5 warnings.
- 30-turn HTTP soak: 0 failures; context bytes min/avg/max 6364/12231/15441; summary chars 0/1259/3730.
- 100-turn storage/compaction: context bytes final 4291; summary chars final 2477; 200 raw messages retained; 190 folded.

## External blocker

No browser backend is connected and no authenticated Customer Zero user token/session is available. Real Customer Zero reads and UI E2E were not attempted; no writes, emails, campaigns, deploys, or sensitive changes were made.

## Resume point

Obtain an authorized authenticated Customer Zero browser session and execute the non-destructive real E2E. Do not repeat the architecture audit.
