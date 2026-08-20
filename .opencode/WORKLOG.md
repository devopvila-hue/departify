# Sprint 67 P0.1 — Worklog

## Recovered state (from the session that died)

Claude had finished P0.1-A end-to-end (server-side name persistence +
deterministic capture + runtime context + ask-once) and had started
P0.1-B: the deterministic `resolveNextBestActions` resolver, the
`CeoMessageResult.nextActions` field on the backend, the
`CommandCenterNextAction` type and the `nextActions` state on the
portal — but the portal had no UI yet (chips were not rendered, and
`setNextActions(result.nextActions ?? [])` was never called).

## What I finished

- **Portal rendering** — `apps/portal/src/routes/ChatRoute.tsx`:
  - Wired `setNextActions(result.nextActions ?? [])` after the response.
  - Re-cap defensively at 3 before render (the backend already caps,
    the portal defends against an older or non-canonical response).
  - Render `.dfy-next-actions` row under the latest assistant reply
    with one `.dfy-chip` per action, classification-aware border, and
    `disabled={busy}` so a stale chip can never fire during a turn.
  - Click handler calls `send(action.request)` — same `send()` path,
    same transport, exactly one execution.

- **Portal styling** — `apps/portal/src/styles/tokens.css`:
  - `.dfy-next-actions` flex row using the existing chip surface.
  - NEEDS_CONNECTION gets a dashed border.
  - NEEDS_APPROVAL gets a warning-tinted border.
  - `disabled` is visually distinct.

- **Test fixture fix** — `apps/backend/test/next-best-actions.test.ts`:
  - The marketing fixture used `producedByCapability: "marketing.plan"`
    which is not a valid `DepartmentWorkCapability`. Replaced with
    `marketing.wordpress.connection.test` (valid, does not affect the
    resolver's department-based branch).

- **Portal test** — `apps/portal/src/routes/next-best-actions.test.tsx`
  (new, 3 cases): N3 (max 3 chips), N7 (greeting yields none),
  N8 (click triggers exactly one new turn with the chip request as
  the user message).

## Verified locally

- Backend typecheck: clean.
- Backend tests: 844 passed (next-best-actions + personal-identity
  both green).
- Engine-adapter typecheck + tests: clean (29 passed).
- Portal typecheck: clean.
- Portal tests: 144 passed (was 141 — added 3 in the new file).
- Portal dev build: succeeds.
- Workspace typecheck: clean across all packages.

## Verified in production (this turn)

- **Backend (Railway `departify-api`)**:
  - Latest deployment: `1dca3366` — SUCCESS
  - Commit: `6e73319386378686c3fa511079ba05fcb62aef9a` (matches my push)
  - `https://api.departify.app/health` → `{"status":"ok"}`
  - `https://api.departify.app/version` → `{"name":"@departify/backend","version":"0.0.0","environment":"production"}`
  - Deploy logs: clean boot, engine adapter initialised, server
    listening on 8080, receiving requests.

- **Portal (Netlify `app.departify.app`)**:
  - HTTP 200, Vite SPA served from `/assets/index-DRzLqWJM.js`
  - JS bundle contains the new markers:
    - `dfy-next-actions` (CSS class for the chip row)
    - `chat-next-actions` (data-testid for the row)
    - `chat-next-action` (data-testid for each chip)
  - This confirms the portal build includes the Next Best Actions UI.

## Out of scope (untouched)

P0.1-A files, OpenClaw gateway, agent.wait, models/providers, SSE,
streaming, content_delta, WritingIndicator, STOP, BYOK, connections,
visual identity, routing, Elvira/Marketing, SEO identity. No
spurious SEO "responsable" was invented.

## Note on GOAL.md

The `.opencode/GOAL.md` file is stale — it describes the Post-OAuth
Gmail Operational Recovery goal that was completed in commit
`686ebdb fix(customer-zero): complete Gmail operational path and real
chat responses` with the final report in `62d2084`. The actual
current sprint is Sprint 67 P0.1 (personal identity + Next Best
Actions), which is what I completed and deployed.

## Known gap

The portal production build requires Netlify env vars
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). These are set in
Netlify (the live deploy proves it — the SPA loads and the API
redirect works). The local production build fails only because those
vars are not in my local shell.

I did NOT exercise the authenticated chat path end-to-end (no CEO
session available from this environment). The code is deployed and
the markers are in the bundle, but the final "type hola, see chips"
smoke test must be done by the user.
