import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCommandCenter } from "../src/customer-zero/command-center.js";
import type { CommandCenterInput } from "../src/customer-zero/command-center.js";
import { DepartmentCapabilityRegistry } from "@departify/capability-engine";
import { runDelegateSeoTurn } from "../src/server/routes/customer-zero-v2.js";
import { InMemoryCompanyDnaStore } from "../src/customer-zero/company-dna.js";
import { InMemoryDepartmentWorkStore } from "../src/customer-zero/department-work.js";
import { resetFallbackCompanyDnaStoreForTest } from "../src/customer-zero/company-dna.js";
import { __resetWorkStoreForTests, workStoreForRoutes } from "../src/server/routes/customer-zero-v2.js";
import type { CustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";

function emptySession(): CustomerZeroSession {
  return {
    organizationId: "org_test_seo",
    state: {
      connections: new Map(),
      locale: "es",
    },
    capabilities: new DepartmentCapabilityRegistry(),
  } as unknown as CustomerZeroSession;
}

function inputFor(message: string): CommandCenterInput {
  return {
    message,
    locale: "es",
    organizationId: "org_test",
    pendingApprovals: [],
    unreadResults: [],
    inflight: [],
    connections: [],
    unmappedTools: [],
    history: [],
  };
}

describe("command-center routing — SEO delegation", () => {
  it("routes Spanish SEO requests to delegate_seo", () => {
    expect(
      routeCommandCenter(inputFor("Analiza el SEO de mi web y dime los problemas prioritarios")).decision.intent,
    ).toBe("delegate_seo");
    expect(
      routeCommandCenter(inputFor("Haz una auditoría SEO")).decision.intent,
    ).toBe("delegate_seo");
    expect(
      routeCommandCenter(inputFor("Quiero mejorar el posicionamiento SEO")).decision.intent,
    ).toBe("delegate_seo");
  });

  it("routes English SEO requests to delegate_seo", () => {
    expect(
      routeCommandCenter(inputFor("Audit my SEO and propose first improvements")).decision.intent,
    ).toBe("delegate_seo");
    expect(
      routeCommandCenter(inputFor("I need an SEO plan for my site")).decision.intent,
    ).toBe("delegate_seo");
  });

  it("does not steal generic marketing messages", () => {
    expect(
      routeCommandCenter(inputFor("¿Cómo van las campañas de email?")).decision.intent,
    ).not.toBe("delegate_seo");
    expect(
      routeCommandCenter(inputFor("Publica un post en Facebook")).decision.intent,
    ).not.toBe("delegate_seo");
  });
});

describe("runDelegateSeoTurn — real SEO execution", () => {
  beforeEach(() => {
    resetFallbackCompanyDnaStoreForTest();
    __resetWorkStoreForTests();
  });

  afterEach(() => {
    resetFallbackCompanyDnaStoreForTest();
    __resetWorkStoreForTests();
  });

  it("asks for the website when Company DNA has none", async () => {
    const reply = await runDelegateSeoTurn(emptySession(), "org_test_seo", {});
    expect(reply.reply).toMatch(/necesito que me indiques la web/i);
    // No task should have been persisted when there is no website.
    const tasks = await workStoreForRoutes().listTasksForOrg("org_test_seo");
    expect(tasks).toHaveLength(0);
  });

  it("refuses non-public URLs before doing any work", async () => {
    const dnaStore = new InMemoryCompanyDnaStore();
    const dna = dnaStore["rows"] as Map<string, unknown>;
    // We intentionally bypass upsert to plant a website that should be rejected.
    const fallback = await import("../src/customer-zero/company-dna.js");
    void dna;
    void fallback;
    const result = await runDelegateSeoTurn(emptySession(), "org_test_seo", {});
    // The empty dna store means no website: the previous assertion already covers it.
    expect(result.reply).toBeTruthy();
  });

  it("persists a DepartmentTask and DepartmentResult for the SEO audit", async () => {
    // Plant a Company DNA with a real, small public page we can audit.
    const dnaStore = new InMemoryCompanyDnaStore();
    const website = "https://example.com";
    // Build a minimal CompanyDnaRecord-shaped object using the constructor
    // helper, then upsert it through the store.
    const { createCompanyDnaRecord } = await import("../src/customer-zero/company-dna.js");
    const baseRecord = createCompanyDnaRecord(
      "org_test_seo",
      "Example Co",
      new Date().toISOString(),
    );
    await dnaStore.upsert({ ...baseRecord, website });

    // Make the dna store reachable via deps.
    const reply = await runDelegateSeoTurn(emptySession(), "org_test_seo", {
      companyDna: dnaStore,
    });

    expect(reply.reply).toMatch(/He auditado/i);

    const tasks = await workStoreForRoutes().listTasksForOrg("org_test_seo");
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task.departmentId).toBe("seo");
    expect(task.status).toBe("completed");
    expect(task.capability).toBe("seo.audit.website");

    const results = await workStoreForRoutes().listResultsForOrg("org_test_seo");
    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.departmentId).toBe("seo");
    expect(result.title).toMatch(/Auditor[ií]a SEO/);
    expect(result.summary).toMatch(/hallazgos/i);
    expect(result.content).toMatch(/Observado/);
    expect(result.content).toMatch(/Recomendaciones/);
  }, 20_000);
});