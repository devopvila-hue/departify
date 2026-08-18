import { describe, expect, it } from "vitest";
import {
  buildSeoAuditCapability,
  buildSeoRepositoryReadCapability,
  SEO_AUDIT_CAPABILITY_ID,
  SEO_REPOSITORY_READ_CAPABILITY_ID,
  SEO_DEPARTMENT,
} from "@departify/capability-engine";

describe("SEO canonical CapabilityContracts", () => {
  it("declares the two SEO capability ids used by DepartmentWorkCapability", () => {
    expect(SEO_AUDIT_CAPABILITY_ID).toBe("seo.audit.website");
    expect(SEO_REPOSITORY_READ_CAPABILITY_ID).toBe("seo.repository.read");
    expect(SEO_DEPARTMENT).toBe("seo");
  });

  it("builds seo.audit.website as a read-only capability with no required connections", () => {
    const cap = buildSeoAuditCapability();
    expect(cap.id).toBe("seo.audit.website");
    expect(cap.department).toBe("seo");
    expect(cap.requiredConnections).toEqual([]);
    expect(cap.requiredCredentials).toEqual([]);
    expect(cap.riskLevel).toBe("read");
    expect(cap.approvalPolicy).toBe("auto");
    expect(cap.writeActions).toEqual([]);
    // Backing tool id matches the canonical Departify tool id.
    const toolIds = cap.actions.map((a) => a.toolId).filter(Boolean);
    expect(toolIds).toContain("departify.seo.audit");
  });

  it("builds seo.repository.read with github_repository as required connection", () => {
    const cap = buildSeoRepositoryReadCapability();
    expect(cap.id).toBe("seo.repository.read");
    expect(cap.department).toBe("seo");
    expect(cap.requiredConnections).toEqual(["github_repository"]);
    expect(cap.riskLevel).toBe("read");
    expect(cap.approvalPolicy).toBe("auto");
    expect(cap.writeActions).toEqual([]);
    const toolIds = cap.actions.map((a) => a.toolId).filter(Boolean);
    expect(toolIds).toContain("departify.seo.repository.list");
    expect(toolIds).toContain("departify.seo.repository.inspect");
  });

  it("verification.status starts at pending — never auto-presents as ready", () => {
    expect(buildSeoAuditCapability().verification.status).toBe("pending");
    expect(buildSeoRepositoryReadCapability().verification.status).toBe("pending");
  });
});