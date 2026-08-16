import { describe, expect, it } from "vitest";
import {
  departmentCapabilityDefinitions,
  projectDepartmentCapabilities,
} from "../src/customer-zero/department-capabilities.js";
import {
  InMemorySeoRepositoryLinkStore,
} from "../src/customer-zero/seo-repository.js";

describe("canonical department capability roster", () => {
  it("keeps Marketing and SEO rosters independent and derived from the registry", () => {
    const marketing = departmentCapabilityDefinitions("marketing");
    const seo = departmentCapabilityDefinitions("seo");

    expect(marketing.length).toBeGreaterThan(3);
    expect(seo.length).toBeGreaterThan(1);
    expect(new Set(marketing.map((entry) => entry.id)).size).toBe(marketing.length);
    expect(new Set(seo.map((entry) => entry.id)).size).toBe(seo.length);
    expect(seo.every((entry) => !marketing.some((candidate) => candidate.id === entry.id))).toBe(true);
  });

  it("keeps a capability visible when its provider is not connected", () => {
    const projection = projectDepartmentCapabilities("marketing", [
      { toolId: "google_ads", state: "needs_connection" },
    ]);
    const paid = projection.find((entry) => entry.id === "marketing.paid");
    const content = projection.find((entry) => entry.id === "marketing.content");

    expect(paid?.state).toBe("necesita_conexion");
    expect(content?.state).toBe("disponible");
  });

  it("does not leak a repository association between organizations", async () => {
    const store = new InMemorySeoRepositoryLinkStore();
    const link = {
      organizationId: "org_a",
      departmentId: "seo" as const,
      website: "https://example.com",
      provider: "github" as const,
      repositoryId: "1",
      repositoryFullName: "company/site",
      defaultBranch: "main",
      access: "read" as const,
      selectedBy: "user_a",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    };
    await store.upsert(link);

    expect(await store.get("org_a", link.website)).toEqual(link);
    expect(await store.get("org_b", link.website)).toBeNull();
  });
});
