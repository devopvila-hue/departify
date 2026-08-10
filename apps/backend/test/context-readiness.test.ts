/**
 * Customer Zero HOTFIX — Readiness gate + no fake data tests.
 *
 * Locks in:
 *   - Pure readiness gate (evaluateReadiness).
 *   - DepartmentStatus returns `not_provisioned` for fresh orgs.
 *   - `getDigitalEmployees` returns [] for fresh orgs (no 12-person
 *     hard-coded roster).
 */

import { describe, expect, it } from "vitest";

import {
  evaluateReadiness,
  freshOrganizationFacts,
  type ReadinessFacts,
} from "../src/customer-zero/context-readiness.js";

describe("Readiness gate (pure)", () => {
  it("A1 fresh organization is NOT ready", () => {
    const result = evaluateReadiness(freshOrganizationFacts());
    expect(result.ready).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(5);
    expect(result.missing).toContain("intake");
    expect(result.missing).toContain("research");
    expect(result.missing).toContain("confirmation");
    expect(result.missing).toContain("blocking_discovery");
    expect(result.missing).toContain("department");
  });

  it("A2 only intake is NOT ready", () => {
    const result = evaluateReadiness({
      hasIntake: true,
      hasCompanyDna: false,
      ceoConfirmed: false,
      blockingDiscoveryComplete: false,
      departmentProvisioned: false,
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("research");
    expect(result.missing).toContain("confirmation");
    expect(result.missing).toContain("blocking_discovery");
    expect(result.missing).toContain("department");
    expect(result.missing).not.toContain("intake");
  });

  it("A3 intake + research is NOT ready (CEO has not confirmed)", () => {
    const result = evaluateReadiness({
      hasIntake: true,
      hasCompanyDna: true,
      ceoConfirmed: false,
      blockingDiscoveryComplete: false,
      departmentProvisioned: false,
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("confirmation");
  });

  it("A4 all five facts true IS ready", () => {
    const result = evaluateReadiness({
      hasIntake: true,
      hasCompanyDna: true,
      ceoConfirmed: true,
      blockingDiscoveryComplete: true,
      departmentProvisioned: true,
    });
    expect(result.ready).toBe(true);
    expect(result.missing.length).toBe(0);
  });

  it("A5 missing department is the last gate — even after all research, org stays not-ready", () => {
    const result = evaluateReadiness({
      hasIntake: true,
      hasCompanyDna: true,
      ceoConfirmed: true,
      blockingDiscoveryComplete: true,
      departmentProvisioned: false,
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["department"]);
  });
});

describe("DepartmentStatus for fresh orgs", () => {
  // These tests guard the MarketingService changes that stop
  // returning the seeded 12-person roster for an org whose Marketing
  // department has not been provisioned through the canonical
  // Customer Zero handoff.
  it("B1 brand-new org returns not_provisioned + zero employees + zero working", async () => {
    const { MarketingService } = await import(
      "../src/customer-zero/marketing-service.js"
    );
    const service = new MarketingService({
      // Provide an engine stub — the service only touches it on
      // active objective lookups, which should not fire for a fresh
      // org.
      engine: { sendMessage: async () => ({ status: "completed", text: "" }) } as unknown as ConstructorParameters<typeof MarketingService>[0]["engine"],
    });
    const status = await service.getDepartmentStatus(
      "org_brand_new",
      [],
      "es",
    );
    expect(status.status).toBe("not_provisioned");
    expect(status.employees).toEqual([]);
    expect(status.employeesWorkingNow).toBe(0);
    expect(status.tools).toEqual([]);
    expect(status.toolsConnected).toBe(0);
    expect(status.activeObjective).toBeNull();
    expect(status.pendingApprovals).toEqual([]);
    expect(status.recentActivity).toEqual([]);
    expect(status.results).toEqual([]);
  }, 30_000);

  it("B2 getDigitalEmployees returns [] for fresh orgs", async () => {
    const { MarketingService } = await import(
      "../src/customer-zero/marketing-service.js"
    );
    const service = new MarketingService({
      engine: { sendMessage: async () => ({ status: "completed", text: "" }) } as unknown as ConstructorParameters<typeof MarketingService>[0]["engine"],
    });
    const employees = await service.getDigitalEmployees("org_brand_new");
    expect(employees).toEqual([]);
  }, 30_000);
});

describe("ReadinessFacts shape", () => {
  it("C1 type contract — every boolean is independent", () => {
    const facts: ReadinessFacts = {
      hasIntake: false,
      hasCompanyDna: false,
      ceoConfirmed: false,
      blockingDiscoveryComplete: false,
      departmentProvisioned: false,
    };
    // Each flag can be flipped independently without crashing the
    // evaluator.
    expect(() => evaluateReadiness(facts)).not.toThrow();
    expect(evaluateReadiness({ ...facts, hasIntake: true }).ready).toBe(false);
  });
});
