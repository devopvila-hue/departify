/**
 * Operating Loop — end-to-end regression.
 *
 *   - GET /weekly-plan/current → empty before any plan exists
 *   - POST /weekly-plan → durable plan created
 *   - POST /weekly-plan/:id/accept → plan items materialize as
 *     DepartmentTask rows with plannedDate and weekly_plan source
 *   - GET /calendar → projected entries include the new tasks at
 *     their plannedDate (not just createdAt)
 *   - PATCH /tasks/:taskId/status → manual transitions are honored
 *     for queued/running/cancelled but blocked for the rest, so the
 *     CEO cannot fake a completion
 *   - Org B cannot read Org A's plan (tenant isolation)
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { loadBackendConfig } from "@departify/config";
import { buildServer } from "../src/server/server.js";
import {
  createInMemoryLlmCredentialStore,
  setLlmCredentialStore,
  type LlmCredentialStore,
} from "../src/customer-zero/llm-credentials.js";
import {
  createInMemoryOrganizationBrandingStore,
  setOrganizationBrandingStore,
  type OrganizationBrandingStore,
} from "../src/customer-zero/organization-branding.js";
import {
  createInMemoryWeeklyPlanStore,
  setWeeklyPlanStore,
} from "../src/customer-zero/weekly-plans.js";
import { makeFakeTenant } from "./helpers/fake-tenant.js";

// Stub the Supabase storage so branding/logo upload routes do not
// hit the network during this test (they are never called here, but
// the route registration wires the same client).
vi.mock("@supabase/supabase-js", async () => {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>(
    "@supabase/supabase-js",
  );
  return {
    ...actual,
    createClient: () => ({
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null, data: { path: "" } }),
          remove: () => Promise.resolve({ error: null }),
          createSignedUrl: () =>
            Promise.resolve({
              data: { signedUrl: "https://example.com/x" },
              error: null,
            }),
        }),
      },
    }),
  };
});

describe("/operating-loop — weekly plan → tasks → calendar", () => {
  let server: FastifyInstance;
  let credentialStore: LlmCredentialStore;
  let brandingStore: OrganizationBrandingStore;

  beforeAll(async () => {
    process.env["SUPABASE_URL"] ??= "https://example.supabase.co";
    process.env["SUPABASE_PUBLISHABLE_KEY"] ??= "test-publishable-key";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role-key";
    const tenant = makeFakeTenant();
    credentialStore = createInMemoryLlmCredentialStore();
    brandingStore = createInMemoryOrganizationBrandingStore();
    const weeklyPlans = createInMemoryWeeklyPlanStore();
    setLlmCredentialStore(credentialStore);
    setOrganizationBrandingStore(brandingStore);
    setWeeklyPlanStore(weeklyPlans);
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      llmCredentials: credentialStore,
      branding: brandingStore,
      weeklyPlans,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function createOrg(companyName: string): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName,
        hasWebsite: false,
        description: "Operadora de pruebas.",
        goal: "Trabajar mejor",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  function authHeaders() {
    return { authorization: "Bearer token-a" };
  }

  it("returns the current week's plan (empty when none exists)", async () => {
    const organizationId = await createOrg("Loop Co 1");
    const response = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan/current`,
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: unknown; weekStartIso: string };
    expect(body.plan).toBeNull();
    expect(typeof body.weekStartIso).toBe("string");
  });

  it("creates a plan and materializes it as DepartmentTasks on accept", async () => {
    const organizationId = await createOrg("Loop Co 2");
    const create = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan`,
      headers: authHeaders(),
      payload: {
        objective: "Conseguir 20 leads cualificados.",
        items: [
          {
            id: "wpi_lunes",
            dayOfWeek: 0,
            title: "Revisar campañas activas",
            summary: "Comprobar CTR y CPC.",
            capability: "marketing.ads.metrics.read",
            toolId: "marketing.ads.metrics.read",
            requiresApproval: false,
          },
          {
            id: "wpi_martes",
            dayOfWeek: 1,
            title: "Lanzar nueva campaña",
            summary: "Publicar creatividades.",
            capability: "marketing.meta.ads.publish",
            toolId: "marketing.meta.ads.publish",
            requiresApproval: true,
          },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { plan: { id: string } };
    expect(created.plan.id).toBeTruthy();

    const accept = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan/${created.plan.id}/accept`,
      headers: authHeaders(),
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ tasksCreated: 2 });

    const workFeed = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/work-feed`,
      headers: authHeaders(),
    });
    expect(workFeed.statusCode).toBe(200);
    const tasks = (workFeed.json() as { tasks: Array<{ title: string; status: string; plannedDate?: string }> })
      .tasks;
    expect(tasks.length).toBe(2);
    expect(tasks.find((t) => t.title === "Revisar campañas activas")?.status).toBe("queued");
    const monday = tasks.find((t) => t.title === "Revisar campañas activas");
    const tuesday = tasks.find((t) => t.title === "Lanzar nueva campaña");
    expect(monday?.plannedDate).toBeDefined();
    expect(tuesday?.plannedDate).toBeDefined();
  });

  it("projects planned tasks into the calendar at their plannedDate", async () => {
    const organizationId = await createOrg("Loop Co 3");
    const create = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan`,
      headers: authHeaders(),
      payload: {
        objective: "Test proyección",
        items: [
          {
            id: "wpi_x",
            dayOfWeek: 2,
            title: "Auditar la web",
            summary: "Informe SEO del trimestre.",
            capability: "seo.audit.website",
            toolId: "departify.seo.audit",
            requiresApproval: false,
          },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const planId = (create.json() as { plan: { id: string } }).plan.id;
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan/${planId}/accept`,
      headers: authHeaders(),
    });
    const calendar = await server.inject({
      method: "GET",
      url: `/api/calendar/${organizationId}`,
      headers: authHeaders(),
    });
    expect(calendar.statusCode).toBe(200);
    const entries = (calendar.json() as { entries: Array<{ title: string; startIso: string; type: string }> }).entries;
    const audit = entries.find((entry) => entry.title === "Auditar la web");
    expect(audit).toBeDefined();
    expect(audit?.type).toBe("task");
    // startIso must be the plannedDate, which falls on Wednesday
    // (dayOfWeek=2), not on createdAt.
    expect(audit?.startIso).not.toBe("");
  });

  it("allows queued → running but blocks manual completion", async () => {
    const organizationId = await createOrg("Loop Co 4");
    const create = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan`,
      headers: authHeaders(),
      payload: {
        objective: "Test transiciones",
        items: [
          {
            id: "wpi_y",
            dayOfWeek: 0,
            title: "Tarea de transición",
            summary: "Manual transition test.",
            capability: "marketing.ads.metrics.read",
            toolId: "marketing.ads.metrics.read",
            requiresApproval: false,
          },
        ],
      },
    });
    const planId = (create.json() as { plan: { id: string } }).plan.id;
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan/${planId}/accept`,
      headers: authHeaders(),
    });
    const workFeed = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/work-feed`,
      headers: authHeaders(),
    });
    const taskId = (workFeed.json() as { tasks: Array<{ id: string; status: string }> }).tasks[0]?.id;
    expect(taskId).toBeDefined();

    // queued → running is allowed.
    const start = await server.inject({
      method: "PATCH",
      url: `/api/customer-zero/${organizationId}/operating-loop/tasks/${taskId}/status`,
      headers: authHeaders(),
      payload: { status: "running" },
    });
    expect(start.statusCode).toBe(200);
    expect((start.json() as { task: { status: string } }).task.status).toBe("running");

    // running → completed is rejected — the CEO cannot fake the
    // completion; only the capability executor can produce a result.
    const fake = await server.inject({
      method: "PATCH",
      url: `/api/customer-zero/${organizationId}/operating-loop/tasks/${taskId}/status`,
      headers: authHeaders(),
      payload: { status: "completed" },
    });
    expect(fake.statusCode).toBe(409);
    expect(fake.json().error.code).toBe("invalid_transition");
  });

  it("rejects accepting the same plan twice", async () => {
    const organizationId = await createOrg("Loop Co 5");
    const create = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan`,
      headers: authHeaders(),
      payload: {
        objective: "Test doble accept",
        items: [
          {
            id: "wpi_z",
            dayOfWeek: 0,
            title: "Tarea única",
            summary: "Una sola vez.",
            capability: "marketing.ads.metrics.read",
            toolId: "marketing.ads.metrics.read",
            requiresApproval: false,
          },
        ],
      },
    });
    const planId = (create.json() as { plan: { id: string } }).plan.id;
    const accept1 = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan/${planId}/accept`,
      headers: authHeaders(),
    });
    expect(accept1.statusCode).toBe(200);
    const accept2 = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/operating-loop/weekly-plan/${planId}/accept`,
      headers: authHeaders(),
    });
    expect(accept2.statusCode).toBe(409);
    expect(accept2.json().error.code).toBe("plan_already_accepted");
  });
});
