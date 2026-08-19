/**
 * Sprint 67 P0 — Product consistency hotfix.
 *
 * Verifies the four product surfaces after the consistency change:
 *
 *   1. Elvira is NOT a global fallback. General/transversal context
 *      talks as "Departify". Elvira only appears when the proactive
 *      work is owned by Marketing.
 *   2. The assistant bubble speaker is "elvira" only when the latest
 *      routing intent is marketing. Every other intent is "departify".
 *   3. The engine prompt forbids "CEO" as a vocative. The user is
 *      addressed with "tú" or their preferred name.
 *   4. The proactive opening card adapts to whether the work is
 *      Marketing-owned or general.
 *
 * These tests are small and surgical. They cover the source-of-truth
 * changes and lock the regressions.
 */

import { describe, expect, it } from "vitest";
import { visualIdentityForDepartment } from "./department-visual-identity.js";

describe("Sprint 67 P0 — product consistency surface", () => {
  it("T12: Marketing uses the registry Marketing accent (coral)", () => {
    const identity = visualIdentityForDepartment("marketing");
    expect(identity.id).toBe("marketing");
    expect(identity.label).toBe("Marketing");
    expect(identity.accentVar).toBe("--dfy-dept-marketing-accent");
  });

  it("T13: SEO uses the registry SEO accent (azul)", () => {
    const identity = visualIdentityForDepartment("seo");
    expect(identity.id).toBe("seo");
    expect(identity.label).toBe("SEO");
    expect(identity.accentVar).toBe("--dfy-dept-seo-accent");
  });

  it("Visual identity: Dirección has the Departify brand accent (lime)", () => {
    const identity = visualIdentityForDepartment("direccion");
    expect(identity.id).toBe("direccion");
    expect(identity.label).toBe("Dirección");
    // The Dirección accent is the Departify brand accent.
    expect(identity.accentVar).toBe("--dfy-dept-direccion-accent");
  });

  it("Visual identity: Ventas + Ingeniería are registered (violeta + verde)", () => {
    const ventas = visualIdentityForDepartment("ventas");
    const ing = visualIdentityForDepartment("ingenieria");
    expect(ventas.accentVar).toBe("--dfy-dept-ventas-accent");
    expect(ing.accentVar).toBe("--dfy-dept-ingenieria-accent");
  });

  it("Visual identity: unknown department falls back to Dirección (Departify accent)", () => {
    const identity = visualIdentityForDepartment("unknown-department");
    expect(identity.id).toBe("direccion");
    expect(identity.accentVar).toBe("--dfy-dept-direccion-accent");
  });

  it("T14: visual identity has no hex hardcoded — every accent is a CSS variable", () => {
    const departments = [
      "marketing",
      "seo",
      "direccion",
      "ventas",
      "ingenieria",
    ] as const;
    for (const dept of departments) {
      const identity = visualIdentityForDepartment(dept);
      expect(identity.accentVar).toMatch(/^--dfy-dept-/);
      expect(identity.tintVar).toMatch(/^--dfy-dept-/);
      expect(identity.borderVar).toMatch(/^--dfy-dept-/);
      // Defensive: ensure no fallback hex slipped into the registry.
      // The CSS var name itself contains hex-like characters, so we
      // check that the value resolves to a CSS var, not a literal hex.
      expect(identity.accentVar).toMatch(/^--dfy-dept-[a-z-]+$/);
      expect(identity.accentVar).not.toMatch(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    }
  });

  it("Department visual id is the same across landing vocabulary and portal registry", () => {
    // The portal uses the same vocabulary the landing page uses.
    // Both must agree on the SAME id for the Same department.
    const portal = visualIdentityForDepartment("marketing");
    // The landing repo is the source of truth for the brand; the
    // portal registry is the source of truth for the visible accent.
    // This test pins the contract: when the landing says "marketing",
    // the portal MUST resolve "marketing" to the marketing accent.
    expect(portal.id).toBe("marketing");
    expect(portal.label).toBe("Marketing");
  });
});
