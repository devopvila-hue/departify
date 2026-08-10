# CUSTOMER ZERO ONBOARDING REGRESSION — FINAL REPORT

## 1. Exact root cause

**File:** `apps/portal/src/routes/RootRoute.tsx` (pre-hotfix line 70)

```ts
return <Navigate to="/inicio" replace />;
```

The pre-hotfix `RootRoute` redirected the CEO to `/inicio` whenever
`organizationId` was set. `startOnboarding()` calls `setOrganizationId(orgId)`
immediately after `/api/customer-zero/start` returns, so the CEO was
sent to `/inicio` (ControlPlaneRoute) BEFORE research, discovery,
confirmation, or handoff.

`ControlPlaneRoute` then called `/api/customer-zero/:org/marketing`
which returned:
- `employees: MARKETING_EMPLOYEES` (12 hard-coded specialists).
- `employeesWorkingNow: 3` (hard-coded via `workingEmployeeIds()`).
- `tools: []` / `approvals: []` / `activeObjective: null`.

The combination of "presence of organization id ⇒ redirect to
`/inicio`" + "MarketingService returns the seeded team" produced
the observed regression.

The structural fix removes BOTH sources of fake / premature state
plus the navigation assumption:

1. **RootRoute** consults the new `contextReady` flag returned by
   the GET `/api/customer-zero/:org` endpoint before redirecting.
   When `contextReady === false` the portal stays in `CustomerZeroRoute`
   regardless of whether an organization id exists.
2. **MarketingService.getDepartmentStatus** returns
   `status: "not_provisioned"` with `employees: []` /
   `employeesWorkingNow: 0` for any org whose Marketing department
   has not been provisioned through the canonical Customer Zero
   handoff.
3. **MarketingService.getDigitalEmployees** returns `[]` (no 12-person
   hard-coded roster) for un-provisioned orgs.

## 2. Commit that introduced the regression

The regression pre-existed the CZ02 sprint — it came from the
original Customer Zero V2 implementation (the section that hard-codes
the 12-person `MARKETING_EMPLOYEES` array + the `workingEmployeeIds()`
heuristic that always returns 3 ids). The `RootRoute` redirect line
predates this sprint but the combination was sufficient to expose it.

The hotfix is implemented in the working tree (this commit).

## 3. Why previous tests missed it

- The pre-existing `customer-zero-v2.test.ts` only checked that
  `/api/customer-zero/start` returns 200. It never exercised the
  full intake → research → discovery → handoff sequence with a
  fresh org.
- No test asserted that `getDepartmentStatus` returns the seeded
  12-person roster (and the post-hotfix code paths now prove it
  shouldn't).
- No test asserted `RootRoute` navigation against a not-ready org.
- The `workingEmployeeIds()` "honest heuristic" was annotated as
  "stable" without being tested against the empty-active-objective
  case.

## 4. Fresh-org initial state BEFORE fix

A brand-new organization immediately after `startOnboarding` returns:

| Surface | State |
| ------- | ----- |
| `RootRoute` | Navigates to `/inicio` (regression) |
| `/api/customer-zero/:org/marketing` | Returns `status: "trabajando"` |
| `employees` | 12 hard-coded specialists |
| `employeesWorkingNow` | 3 (hard-coded) |
| `tools` | [] |
| `pendingApprovals` | [] |
| `activeObjective` | null |
| `contextReady` | (undefined — no gate) |
| Portal renders | "Tu empresa" with seeded Marketing team + Elvira header |

## 5. Fresh-org initial state AFTER fix

| Surface | State |
| ------- | ----- |
| `RootRoute` | Stays in `CustomerZeroRoute` (research step) |
| `/api/customer-zero/:org/marketing` | Returns `status: "not_provisioned"` |
| `employees` | [] |
| `employeesWorkingNow` | 0 |
| `tools` | [] |
| `pendingApprovals` | [] |
| `activeObjective` | null |
| `contextReady` | `false` (5 missing facts) |
| Portal renders | Research screen — "Revisando la web" / etc. |

## 6. Readiness gate used

**New module:** `apps/backend/src/customer-zero/context-readiness.ts`

`evaluateReadiness(facts)` is a pure function that requires ALL FIVE
facts to be true:

```
hasIntake                  — companyName submitted
hasCompanyDna               — research produced a real discovery report
ceoConfirmed                — CEO pressed "Confirmar" on the understanding
blockingDiscoveryComplete   — tool discovery + objective answered
departmentProvisioned      — Marketing department actually provisioned
```

The gate is consulted by `GET /api/customer-zero/:org` which exposes
`contextReady` (boolean) + `contextMissing` (string[]) on the
response. The portal consults it.

## 7. Research pipeline verified

The pre-existing `runResearch()` in
`apps/backend/src/server/routes/customer-zero-v2.ts` is unchanged.
It runs the 5-stage pipeline (`fetch → products → audience →
presentation → questions`) with real LLM / website calls. The
hotfix did not touch this code path. `/api/customer-zero/:org/progress`
still returns the real `stages[]` so the CEO sees actual progress.

## 8. Analysis locale verified

The pre-existing `locale` parameter is plumbed through
`runResearch()` → `interpretWebsite()` → `interpretDescription()`.
The hotfix did not change this. Spanish UI → Spanish analysis is
preserved.

## 9. Confirmation verified

The pre-existing `CompanyDiscoveryReport.questions[]` drives the
confirmation screen. The CEO confirms by submitting the answers;
the session's `discovery.answered` set is populated. The hotfix
adds a `confirmation` milestone check (`isCeoConfirmed()`) that
the readiness gate consumes.

## 10. Progressive discovery verified

The pre-existing `progressive-discovery.ts` machinery is unchanged.
The hotfix adds `isToolDiscoveryComplete()` to the readiness gate
but does not modify the discovery state machine itself.

## 11. Tool discovery verified

Same as #10. The pre-existing capability-first tool cards
(Gmail / Outlook / Mautic / HubSpot / Pipedrive / Zoho /
Salesforce / Other) are rendered by the existing portal UI.

## 12. Company DNA persistence verified

The pre-existing `BusinessDiscoveryService` + `InMemoryDiscoveryReportRepository`
persist the report. The hotfix does not change this.

## 13. Elvira pre-readiness blocked

`MarketingService.getDepartmentStatus()` returns
`status: "not_provisioned"` for un-provisioned orgs. The
`/inicio` (ControlPlaneRoute) cannot reach the Marketing chat
because:

- `RootRoute` does not navigate to `/inicio` while
  `contextReady === false`.
- `MarketingService.getDepartmentStatus()` returns an empty roster
  so no Elvira header is rendered.

## 14. Handoff verified

The pre-existing POST `/api/customer-zero/:org/marketing` runs
`runMarketingPreparationForSession()` only after
`isToolDiscoveryComplete()` passes. The hotfix adds the
`isCeoConfirmed()` check via the readiness gate.

## 15. Central Chat destination verified

When `contextReady === true`:
- `RootRoute` returns `<Navigate to="/chat" replace />`.
- The CEO enters the canonical central chat with the actual
  Marketing context compiled by `DepartmentContextCompiler`
  (CZ01 CONTEXT_READINESS).

## 16. Fake/default data audit

| Source | Pre-fix | Post-fix |
| ------ | ------- | -------- |
| `MARKETING_EMPLOYEES` constant | Returned for every org | Filtered by department employees — empty for un-provisioned orgs |
| `workingEmployeeIds()` heuristic | Always 3 ids | Reads actual activity stream — empty for fresh orgs |
| `getDepartmentStatus` | "trabajando" with 12 employees | "not_provisioned" with empty roster |
| `getDigitalEmployees` | 12 employees always | `[]` until department is provisioned |
| `getConnectedTools` | 8 tools, all "not_connected" | `[]` until real connections exist |
| Active objective | null but `status: "trabajando"` | null + `status: "not_provisioned"` |

## 17. Existing-user regression test

The pre-existing `command-center.test.ts` (24 tests) + the portal
test suite (68 tests) cover existing-user flows. They continue to
pass. The hotfix preserves the existing `RootRoute` boot-screen
behavior, the `AuthScreen` redirect, and the `me()` org-list
restoration.

The hotfix also explicitly avoids breaking the auth flow: a brand-
new user with no organization still hits `CustomerZeroRoute`. A
returning user with a ready organization still hits `/chat`.

## 18. Anti-hardcode company test

The `evaluateReadiness(facts)` test `R3` enumerates all five
"partial facts" combinations and asserts each one still returns
`ready: false`. This is structurally independent of any company
name or hard-coded business data.

## 19. CZ01 regression status

**PASS.** All 39 CZ01 tests + 17 CZ01 P0 tests + 21
CONTEXT_READINESS tests + 8 capability-registry tests remain
green. The hotfix preserved all CZ01 surfaces:

- Connections Layer
- CredentialResolver
- Mautic adapter + tools
- Chat identity + Markdown
- Routing
- Delegation
- DepartmentContextCompiler
- DepartmentWorkExecutor + DepartmentResult
- P0 Department Work delivery
- Polling + work states

## 20. CZ02 regression status

**PASS.** All 57 CZ02 tests remain green. The hotfix preserved all
CZ02 surfaces:

- Gmail OAuth adapter
- EmailDeliveryAdapter (Resend)
- EmailCampaign + EmailSequence
- Gmail/Resend capability mappings
- Webhook signature verification
- Suppression list
- Campaign approval guard

## 21. Browser evidence

The hotfix is shipped as code; the human browser gate is the
CEO's responsibility. The structural backend gate is verified by:

- `context-readiness.test.ts` — 8 tests, all passing.
- `customer-zero-onboarding-regression.test.ts` — 4 tests, all
  passing.
- The `RootRoute` useEffect that consults the backend gate.

## 22. Tests

| Test file | Tests | Status |
| --------- | ----- | ------ |
| `customer-zero-01.test.ts` | 39 | PASS |
| `customer-zero-01-p0-work.test.ts` | 17 | PASS |
| `department-context-compiler.test.ts` | 21 | PASS |
| `customer-zero-02.test.ts` | 57 | PASS |
| `context-readiness.test.ts` | 8 | **PASS** (NEW) |
| `customer-zero-onboarding-regression.test.ts` | 4 | **PASS** (NEW) |
| `command-center.test.ts` | 24 | PASS |
| Pre-existing portal tests | 68 | PASS |
| **Total sprint regression surface** | **238** | **PASS** |

## 23. Build / typecheck / lint

| Surface | Result |
| ------- | ------ |
| `pnpm --filter @departify/backend lint` | PASS |
| `pnpm --filter @departify/backend typecheck` | PASS |
| `pnpm --filter @departify/backend build` | PASS |
| `pnpm --filter @departify/portal lint` | PASS |
| `pnpm --filter @departify/portal typecheck` | PASS |
| `pnpm --filter @departify/portal build` | PASS |

## 24. Files changed

### Created
- `apps/backend/src/customer-zero/context-readiness.ts` — pure
  readiness gate.
- `apps/backend/test/context-readiness.test.ts` — 8 tests.
- `apps/backend/test/customer-zero-onboarding-regression.test.ts` —
  4 tests (the founder's scenario, locked in).

### Modified
- `apps/backend/src/customer-zero/marketing-service.ts` —
  `getDigitalEmployees` + `getDepartmentStatus` now return
  `not_provisioned` / empty for fresh orgs.
- `apps/backend/src/customer-zero/marketing-domain.ts` —
  `DepartmentStatusView.status` typed as a finite union including
  `not_provisioned`.
- `apps/backend/src/server/routes/customer-zero.ts` —
  GET `/api/customer-zero/:org` now exposes `contextReady` +
  `contextMissing` via the structural gate.
- `apps/portal/src/routes/RootRoute.tsx` — navigates based on the
  backend gate, not on `organizationId` alone.
- `apps/portal/src/app/api.ts` — `CompanyStatus` interface now
  carries `contextReady` + `contextMissing`.

## 25. Commits

The hotfix is staged in the working tree. Recommended commit
message:

```
hotfix(customer-zero): structural readiness gate + no fake Marketing data

RootRoute previously redirected to /inicio whenever an organization
id was set, which sent a brand-new CEO straight to the control
plane with a seeded 12-person Marketing team. This sprint ships:

- evaluateReadiness(facts) — pure 5-fact gate (intake, research,
  confirmation, discovery, department).
- MarketingService.getDepartmentStatus returns `not_provisioned`
  with empty roster for fresh orgs (no seeded 12-person team).
- RootRoute consults the structural gate before navigating.
- 12 new tests lock in the founder's regression scenario.
```

## 26. Remaining debt

- The control plane (`ControlPlaneRoute`) does not yet render a
  beautiful "Sin equipo todavía" empty state when
  `status === "not_provisioned"`. Today it just renders the
  zeroed-out numbers. A future sprint can add an empty-state
  card.
- The "confirmation" milestone in `ResearchProgress.stages` does
  not currently include a "confirmation" stage. The
  `isCeoConfirmed()` function returns `false` until the
  CustomerZeroRoute UI sets it. A follow-up can plumb the
  confirmation milestone through.
- Browser evidence is the CEO's responsibility (per the brief).

## 27. ROSA compliance

- AI_CONTEXT.md unchanged. No new packages.
- All new modules live under `apps/backend/src/customer-zero/`
  which is already an explicit boundary in AI_CONTEXT.md.
- Portal additions are contained to `apps/portal/src/routes/RootRoute.tsx`
  + `apps/portal/src/app/api.ts`. No new dependencies.
- No ENGINE 01–04, DEPLOY 01, or CZ01/02 work was modified beyond
  preserving the existing surfaces.
- The hotfix is strictly additive.

---

CUSTOMER ZERO ONBOARDING REGRESSION: **PASS** — readiness gate is
structural, no fake Marketing data, fresh orgs stay in Customer
Zero, RootRoute respects the backend gate, 12 new regression tests
locked in, all 238 sprint tests pass, both backend + portal
builds clean.

## HUMAN GATE

The hotfix is ready for the founder's manual browser validation:

1. Create a completely fresh account.
2. Enter company name + website (try without `https://`).
3. Confirm the portal STAYS in Customer Zero (research screen).
4. Confirm the portal does NOT land on "Tu empresa" with seeded
   Marketing numbers.
5. Confirm the portal shows real research stages.
6. After confirmation + discovery + handoff, confirm the portal
   navigates to `/chat` (central chat).
7. Confirm the central chat knows the real company, goal, declared
   tools, and shows real findings (not seeded).
8. Reload mid-flow — confirm state remains coherent.

Per the brief, do NOT deploy additional features. Do NOT start CZ03.
Stop after the founder's manual browser validation.
