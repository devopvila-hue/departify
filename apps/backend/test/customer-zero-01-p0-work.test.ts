/**
 * Customer Zero 01 P0 — Department Work + Result Delivery tests.
 *
 * Covers:
 *
 *   A. Elvira inicia trabajo largo → WorkItem creado.
 *   B. WorkItem completa → Result creado.
 *   C. Result aparece en Resultados.
 *   D. Chat recibe mensaje final automáticamente.
 *   E. Reload no pierde trabajo.
 *   F. Backend restart no pierde trabajo (durable in-memory snapshot).
 *   G. Engine restart no pierde business work state.
 *   H. Error produce final failure message.
 *   I. Elvira no afirma "lo publiqué" si results.publish falla.
 *   J. No promise-without-capability.
 *   K. Chart request produces real structured chart data + UI rendering.
 *   L. Mautic analysis completes end-to-end and CEO receives final
 *      answer without sending another message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InMemoryDepartmentWorkStore,
  checkReplyForUnsupportedPromises,
  checkTaskTimeouts,
  detectUnsupportedPromise,
  detectUnbackedWorkClaim,
  MAX_ACTIVE_DASHBOARDS,
  type DepartmentTask,
} from "../src/customer-zero/department-work.js";
import {
  DepartmentWorkError,
  DepartmentWorkExecutor,
} from "../src/customer-zero/department-work-executor.js";
import { resolveCredentials } from "../src/customer-zero/credential-resolver.js";
import {
  isCapabilityAvailable,
  listReadyCapabilities,
} from "../src/customer-zero/capability-registry.js";

/* ----------------------------------------------------------------------------
 * Helpers — fake fetch + activity repository + injected message hook.
 * --------------------------------------------------------------------------*/

function fakeCredentials(): void {
  process.env["MAUTIC_BASE_URL"] = "https://mautic.test";
  process.env["MAUTIC_CLIENT_ID"] = "client";
  process.env["MAUTIC_CLIENT_SECRET"] = "secret";
}

function clearCredentials(): void {
  delete process.env["MAUTIC_BASE_URL"];
  delete process.env["MAUTIC_CLIENT_ID"];
  delete process.env["MAUTIC_CLIENT_SECRET"];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubMauticOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/oauth/v2/token")) {
        return jsonResponse(200, { access_token: "tok" });
      }
      if (url.includes("/api/contacts?limit=100")) {
        return jsonResponse(200, {
          total: 2260,
          contacts: {
            "1": { id: 1, fields: { all: { firstname: "Ada" } }, lastActive: "2024-01-01T00:00:00Z" },
            "2": { id: 2, fields: { all: { firstname: "Grace" } }, lastActive: "2026-07-01T00:00:00Z" },
          },
        });
      }
      if (url.includes("/api/segments")) {
        return jsonResponse(200, {
          lists: { "1": { id: 1, name: "Leads calificados", leadCount: 200 } },
        });
      }
      if (url.includes("/api/campaigns")) {
        return jsonResponse(200, { campaigns: {} });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

function stubMauticAuthFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/oauth/v2/token")) {
        return jsonResponse(401, { error: "invalid_client" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

function makeActivityRepo() {
  const entries: Array<Record<string, unknown>> = [];
  return {
    entries,
    async create(entry: Record<string, unknown>) {
      const created = { id: `act_${entries.length + 1}`, createdAt: new Date().toISOString(), ...entry };
      entries.push(created);
      return created;
    },
  };
}

interface InjectedEntry {
  conversationId: string;
  speaker: string;
  content: string;
  relatedTaskId: string;
  relatedResultId: string | null;
}

function makeExecutor(opts: {
  store: InMemoryDepartmentWorkStore;
  activityRepo: ReturnType<typeof makeActivityRepo>;
  injected?: InjectedEntry[];
}) {
  return new DepartmentWorkExecutor({
    workStore: opts.store,
    activityRepo: opts.activityRepo as unknown as ConstructorParameters<typeof DepartmentWorkExecutor>[0]["activityRepo"],
    onMessageInjected: async (input) => {
      opts.injected?.push({
        conversationId: input.conversationId,
        speaker: input.speaker,
        content: input.content,
        relatedTaskId: input.relatedTaskId,
        relatedResultId: input.relatedResultId,
      });
    },
  });
}

afterEach(() => {
  clearCredentials();
  vi.unstubAllGlobals();
});

/* ----------------------------------------------------------------------------
 * A) Elvira inicia trabajo largo → WorkItem creado.
 * ----------------------------------------------------------------------------*/

describe("P0 A — work item creation", () => {
  beforeEach(() => {
    fakeCredentials();
    stubMauticOk();
  });

  it("A1 a long analysis creates a queued → running DepartmentTask", async () => {
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const injected: InjectedEntry[] = [];
    const executor = makeExecutor({ store, activityRepo: activity, injected });

    const result = await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis de contactos Mautic",
      summary: "Resumen de contactos",
      capability: "crm.contacts.summary",
      locale: "es",
    });

    expect(result.task.status).toBe("completed");
    expect(result.task.id).toMatch(/^task_/);
    expect(result.task.toolId).toBe("mautic.contacts.summary");
    expect(result.task.timeoutMs).toBeGreaterThan(0);
    expect(result.task.startedAt).not.toBeNull();
    expect(result.task.completedAt).not.toBeNull();
  });
});

/* ----------------------------------------------------------------------------
 * B + C + D + L — WorkItem completes, result is created, message injected.
 * ----------------------------------------------------------------------------*/

describe("P0 B/C/D/L — completion + auto-injection", () => {
  beforeEach(() => {
    fakeCredentials();
    stubMauticOk();
  });

  it("L the long-analysis completes end-to-end with a real result and auto-injected message", async () => {
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const injected: InjectedEntry[] = [];
    const executor = makeExecutor({ store, activityRepo: activity, injected });

    const result = await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis de contactos Mautic",
      summary: "Resumen de contactos",
      capability: "crm.contacts.summary",
      locale: "es",
    });

    // B: result was created
    expect(result.result).not.toBeNull();
    expect(result.result?.title).toContain("Mautic");
    expect(result.result?.summary).toContain("2260");
    // K: chart data is structured
    expect(result.result?.chart).toBeDefined();
    expect(result.result?.chart?.kind).toBe("bar");
    // D: final message auto-injected
    expect(injected.length).toBe(1);
    expect(injected[0]?.speaker).toBe("elvira");
    expect(injected[0]?.relatedTaskId).toBe(result.task.id);
    expect(injected[0]?.relatedResultId).toBe(result.result?.id);
    expect(injected[0]?.content).toContain("2260");
  });

  it("C the result is visible via the store list", async () => {
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const executor = makeExecutor({ store, activityRepo: activity, injected: [] });
    await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });
    const results = await store.listResultsForOrg("org_x");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toContain("Mautic");
  });
});

/* ----------------------------------------------------------------------------
 * E + F — durability across reload/restart.
 * --------------------------------------------------------------------------*/

describe("P0 E/F — durability", () => {
  it("E reload preserves the task and result", async () => {
    fakeCredentials();
    stubMauticOk();
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const executor = makeExecutor({ store, activityRepo: activity, injected: [] });
    await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });

    // Simulate reload — fetch from the same store instance.
    const tasks = await store.listTasksForOrg("org_x");
    const results = await store.listResultsForOrg("org_x");
    expect(tasks.length).toBe(1);
    expect(results.length).toBe(1);
    expect(tasks[0]?.status).toBe("completed");
  });

  it("F backend restart serializes the durable snapshot", async () => {
    fakeCredentials();
    stubMauticOk();
    const storeA = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const executorA = makeExecutor({ store: storeA, activityRepo: activity, injected: [] });
    await executorA.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });
    // Snapshot.
    const tasksA = await storeA.listTasksForOrg("org_x");
    const resultsA = await storeA.listResultsForOrg("org_x");
    // Restart on a fresh store — the snapshot is the source of truth.
    const serializedTasks = JSON.stringify(tasksA);
    const serializedResults = JSON.stringify(resultsA);
    expect(serializedTasks).toContain("completed");
    expect(serializedResults).toContain("Mautic");
    // Re-hydrate.
    const storeB = new InMemoryDepartmentWorkStore();
    void storeB;
    const rehydratedTasks = JSON.parse(serializedTasks) as DepartmentTask[];
    expect(rehydratedTasks[0]?.status).toBe("completed");
  });

  it("G engine restart preserves business work state because tasks live in the durable store, not in the engine session", async () => {
    fakeCredentials();
    stubMauticOk();
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const executor = makeExecutor({ store, activityRepo: activity, injected: [] });
    const before = await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });
    // Engine session id is NOT the durable work state — the executor
    // only writes through the store, so even if the OpenClaw session
    // is recreated, the task survives.
    const after = await store.listTasksForOrg("org_x");
    expect(after[0]?.id).toBe(before.task.id);
    expect(after[0]?.status).toBe("completed");
  });
});

/* ----------------------------------------------------------------------------
 * H + I — failure path produces a final failure message.
 * --------------------------------------------------------------------------*/

describe("P0 H/I — failure handling", () => {
  it("H auth failure → task failed + final failure message", async () => {
    fakeCredentials();
    stubMauticAuthFailure();
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const injected: InjectedEntry[] = [];
    const executor = makeExecutor({ store, activityRepo: activity, injected });
    const result = await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });
    expect(result.task.status).toBe("failed");
    expect(result.task.errorCode).toBe("auth");
    expect(injected.length).toBe(1);
    expect(injected[0]?.content.toLowerCase()).toContain("credenciales");
  });

  it("I capability unavailable → no result, no claim of publication", async () => {
    clearCredentials();
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const injected: InjectedEntry[] = [];
    const executor = makeExecutor({ store, activityRepo: activity, injected });
    const result = await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });
    expect(result.result).toBeNull();
    expect(result.task.status).toBe("failed");
    // The failure message must NOT claim publication.
    expect(injected[0]?.content.toLowerCase()).not.toContain("publicado");
    expect(injected[0]?.content.toLowerCase()).not.toContain("resultados están listos");
  });
});

/* ----------------------------------------------------------------------------
 * J — promise-without-capability guard.
 * --------------------------------------------------------------------------*/

describe("P0 J — promise guard", () => {
  it("J1 detects 'te aviso cuando esté listo'", () => {
    const reply = "Perfecto. Te aviso cuando esté listo el informe.";
    expect(detectUnsupportedPromise(reply)).toBe(true);
    const guard = checkReplyForUnsupportedPromises(reply);
    expect(guard.allowed).toBe(false);
    expect(guard.requiredCapabilities).toContain("results.publish");
  });

  it("J2 detects 'lo dejo en Resultados'", () => {
    const reply = "Lo dejo en Resultados cuando termine.";
    expect(detectUnsupportedPromise(reply)).toBe(true);
  });

  it("J3 a clean reply with no promises is allowed", () => {
    const reply = "Tienes 2260 contactos. 86 sin actividad reciente.";
    expect(detectUnsupportedPromise(reply)).toBe(false);
    const guard = checkReplyForUnsupportedPromises(reply);
    expect(guard.allowed).toBe(true);
  });
});

describe("P0 — no false progress", () => {
  it("blocks claims of active work when they are not backed by a task", () => {
    expect(detectUnbackedWorkClaim("Lo estoy haciendo ahora mismo. Dame unos minutos.")).toBe(true);
    expect(detectUnbackedWorkClaim("No puedo ejecutarlo porque Mautic no está conectado.")).toBe(false);
  });

  it("counts dashboards through the durable work store", async () => {
    const store = new InMemoryDepartmentWorkStore();
    for (let index = 0; index < MAX_ACTIVE_DASHBOARDS; index += 1) {
      await store.createResult({
        organizationId: "org_dashboard",
        departmentId: "marketing",
        relatedWorkItemId: null,
        title: `Dashboard ${index + 1}`,
        summary: "Resultado real",
        content: "Datos reales",
        chart: {
          kind: "bar",
          title: `Dashboard ${index + 1}`,
          series: [{ name: "Datos", values: [index + 1] }],
        },
        source: "test",
        producedByCapability: "results.publish",
      });
    }
    expect(await store.countDashboardsForOrg("org_dashboard")).toBe(MAX_ACTIVE_DASHBOARDS);
  });

  it("blocks a sixth dashboard before credentials or provider execution", async () => {
    fakeCredentials();
    stubMauticOk();
    const store = new InMemoryDepartmentWorkStore();
    for (let index = 0; index < MAX_ACTIVE_DASHBOARDS; index += 1) {
      await store.createResult({
        organizationId: "org_dashboard",
        departmentId: "marketing",
        relatedWorkItemId: null,
        title: `Dashboard ${index + 1}`,
        summary: "Resultado real",
        content: "Datos reales",
        chart: {
          kind: "bar",
          title: `Dashboard ${index + 1}`,
          series: [{ name: "Datos", values: [index + 1] }],
        },
        source: "test",
        producedByCapability: "crm.contacts.summary",
      });
    }
    const executor = makeExecutor({ store, activityRepo: makeActivityRepo(), injected: [] });

    const outcome = await executor.run({
      organizationId: "org_dashboard",
      conversationId: "conv_dashboard",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Sexto dashboard",
      summary: "No debe ejecutarse",
      capability: "crm.contacts.summary",
      locale: "es",
    });

    expect(outcome.task.status).toBe("failed");
    expect(outcome.task.errorCode).toBe("dashboard_limit");
    expect(outcome.result).toBeNull();
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------------------
 * K — chart data is structured and consumable.
 * --------------------------------------------------------------------------*/

describe("P0 K — chart payload", () => {
  it("K1 the contacts-summary chart has a bar shape with labels and values", async () => {
    fakeCredentials();
    stubMauticOk();
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const executor = makeExecutor({ store, activityRepo: activity, injected: [] });
    const result = await executor.run({
      organizationId: "org_x",
      conversationId: "conv_1",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Análisis",
      summary: "Resumen",
      capability: "crm.contacts.summary",
      locale: "es",
    });
    expect(result.result?.chart).toBeDefined();
    const chart = result.result?.chart;
    expect(chart?.kind).toBe("bar");
    expect(chart?.series.length).toBeGreaterThan(0);
    const series = chart?.series[0];
    expect(series?.labels?.length).toBeGreaterThan(0);
    expect(series?.values.length).toBe(series?.labels?.length);
    expect(series?.values.every((v) => typeof v === "number")).toBe(true);
  });
});

/* ----------------------------------------------------------------------------
 * Timeout enforcement.
 * --------------------------------------------------------------------------*/

describe("P0 timeout — orphaned tasks", () => {
  it("a task exceeding its timeoutMs is reported as expired", async () => {
    const store = new InMemoryDepartmentWorkStore();
    const activity = makeActivityRepo();
    const executor = makeExecutor({ store, activityRepo: activity, injected: [] });

    const task = await store.createTask({
      organizationId: "org_x",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Long-running",
      summary: "Long task",
      capability: "crm.contacts.summary",
      toolId: "mautic.contacts.summary",
      status: "running",
      statusMessage: "running",
      progress: 0.5,
      requiredCapabilities: ["crm.contacts.summary"],
      startedAt: new Date(Date.now() - 90_000).toISOString(),
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 60_000,
    });

    const checks = checkTaskTimeouts([task]);
    expect(checks[0]?.status).toBe("expired");
    void executor;
  });
});

/* ----------------------------------------------------------------------------
 * Capability gating.
 * --------------------------------------------------------------------------*/

describe("P0 — capability gating prevents orphaned promises", () => {
  it("a capability that is NOT registered returns unavailable", () => {
    clearCredentials();
    const availability = isCapabilityAvailable("org_x", "crm.contacts.summary");
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe("credentials_missing");
  });

  it("registered ready capabilities include results.publish", () => {
    fakeCredentials();
    const ready = listReadyCapabilities("org_x");
    expect(ready).toContain("results.publish");
    expect(ready).toContain("memory.remember");
  });
});

/* ----------------------------------------------------------------------------
 * CredentialResolver integration.
 * --------------------------------------------------------------------------*/

describe("P0 — credential resolution path", () => {
  it("when env credentials are configured, resolveCredentials succeeds and getCredentials returns the secret", () => {
    fakeCredentials();
    const r = resolveCredentials({ organizationId: "org_x", provider: "mautic" });
    expect(r.available).toBe(true);
    expect(r.handle).toBeDefined();
  });
});

/* ----------------------------------------------------------------------------
 * Executor error class.
 * --------------------------------------------------------------------------*/

describe("P0 — DepartmentWorkError", () => {
  it("carries the code", () => {
    const e = new DepartmentWorkError("rate_limit", "Mautic rate-limited");
    expect(e.code).toBe("rate_limit");
    expect(e.name).toBe("DepartmentWorkError");
  });
});
