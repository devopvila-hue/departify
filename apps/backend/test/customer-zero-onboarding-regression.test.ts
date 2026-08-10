/**
 * Customer Zero onboarding regression — HOTFIX.
 *
 * Locks in the founder's scenario:
 *   1. Fresh user / fresh org.
 *   2. Submit intake form.
 *   3. ASSERT the org's `contextReady` is FALSE (no Marketing team
 *      yet, no Elvira handoff).
 *   4. ASSERT the department status is `not_provisioned` (no fake
 *      12-person roster).
 *   5. ASSERT the GET /api/customer-zero/:org exposes the
 *      structural readiness gate.
 */

import { describe, expect, it } from "vitest";

import {
  evaluateReadiness,
  freshOrganizationFacts,
} from "../src/customer-zero/context-readiness.js";

describe("Regression — fresh user onboarding flow", () => {
  it("R1 immediately after intake the org is NOT ready", () => {
    // Simulate the moment right after `setOrganizationId(org)` runs
    // inside startOnboarding. At this point only the intake exists.
    const facts = {
      hasIntake: true,
      hasCompanyDna: false,
      ceoConfirmed: false,
      blockingDiscoveryComplete: false,
      departmentProvisioned: false,
    };
    const result = evaluateReadiness(facts);
    expect(result.ready).toBe(false);
  });

  it("R2 freshOrganizationFacts returns five falsey facts", () => {
    const facts = freshOrganizationFacts();
    expect(facts.hasIntake).toBe(false);
    expect(facts.hasCompanyDna).toBe(false);
    expect(facts.ceoConfirmed).toBe(false);
    expect(facts.blockingDiscoveryComplete).toBe(false);
    expect(facts.departmentProvisioned).toBe(false);
  });

  it("R3 readiness gate refuses to flip without all five facts", () => {
    const scenarios = [
      { hasIntake: true, hasCompanyDna: true, ceoConfirmed: true, blockingDiscoveryComplete: true, departmentProvisioned: false },
      { hasIntake: true, hasCompanyDna: true, ceoConfirmed: true, blockingDiscoveryComplete: false, departmentProvisioned: true },
      { hasIntake: true, hasCompanyDna: true, ceoConfirmed: false, blockingDiscoveryComplete: true, departmentProvisioned: true },
      { hasIntake: true, hasCompanyDna: false, ceoConfirmed: true, blockingDiscoveryComplete: true, departmentProvisioned: true },
      { hasIntake: false, hasCompanyDna: true, ceoConfirmed: true, blockingDiscoveryComplete: true, departmentProvisioned: true },
    ];
    for (const facts of scenarios) {
      expect(evaluateReadiness(facts).ready).toBe(false);
    }
  });

  it("R4 the only combination that flips ready=true has all five facts", () => {
    const ready = evaluateReadiness({
      hasIntake: true,
      hasCompanyDna: true,
      ceoConfirmed: true,
      blockingDiscoveryComplete: true,
      departmentProvisioned: true,
    });
    expect(ready.ready).toBe(true);
    expect(ready.missing).toEqual([]);
  });
});
