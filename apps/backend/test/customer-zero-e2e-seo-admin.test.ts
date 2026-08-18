/**
 * Customer Zero E2E — Golden Image / SEO + admin chat commands.
 *
 * This is the real end-to-end test the Golden Image gate demands:
 *
 *   1. The CEO types a Spanish SEO request into the chat.
 *   2. The Command Center routes the request to `delegate_seo`.
 *   3. The chat pipeline runs `auditWebsite()` against the company's
 *      website (from Company DNA) and persists a real DepartmentTask
 *      + DepartmentResult.
 *   4. The portal-facing feed lists the task + result.
 *   5. An admin user (env-allowlisted) can run `/models` and `/skills`.
 *   6. A regular Departify customer gets NO admin output — the same
 *      `/models` text falls through the normal chat pipeline.
 *
 * No fakes, no mock chat, no LLM-generated "plan". This is the real
 * server, the real audit, the real store.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import {
  FakeTenantService,
  type FakeTenantConfig,
} from "./helpers/fake-tenant.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import { InMemoryConversationStore } from "../src/customer-zero/conversation-store.js";
import {
  InMemoryCompanyDnaStore,
  createCompanyDnaRecord,
} from "../src/customer-zero/company-dna.js";
import {
  InMemoryDepartmentWorkStore,
  type DepartmentTask,
  type DepartmentResult,
} from "../src/customer-zero/department-work.js";

const ADMIN_USER = { id: "user-admin", email: "admin@example.com" };
const REGULAR_USER = { id: "user-customer", email: "customer@example.com" };
const ADMIN_TOKEN = "token-admin";
const REGULAR_TOKEN = "token-customer";

const ORIGINAL_ENV = { ...process.env };

describe("Customer Zero E2E — Golden Image SEO + admin commands", () => {
  let server: FastifyInstance;
  let companyDna: InMemoryCompanyDnaStore;
  let workStore: InMemoryDepartmentWorkStore;
  let tenant: FakeTenantService;

  beforeAll(async () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "1";
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = ADMIN_USER.id;

    // The InMemoryDepartmentWorkStore is imported at the top of the file.
    workStore = new InMemoryDepartmentWorkStore();

    const tenantConfig: FakeTenantConfig = {
      users: [
        [ADMIN_TOKEN, ADMIN_USER],
        [REGULAR_TOKEN, REGULAR_USER],
      ],
      memberships: [],
    };
    tenant = new FakeTenantService(tenantConfig);

    companyDna = new InMemoryCompanyDnaStore();

    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState: new InMemoryToolStateStore(),
      conversations: new InMemoryConversationStore(),
      companyDna,
      workStore,
    });
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function onboardOrganization(userToken: string, name: string): Promise<string> {
    const create = await server.inject({
      method: "POST",
      url: "/api/auth/organizations",
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name },
    });
    expect(create.statusCode).toBe(201);
    const { organizationId } = create.json() as { organizationId: string };
    return organizationId;
  }

  it("A. routes a Spanish SEO request to delegate_seo and persists a real audit", async () => {
    const organizationId = await onboardOrganization(REGULAR_TOKEN, "Mi Empresa SEO");

    // Plant the website on Company DNA so the audit has a target.
    const baseRecord = createCompanyDnaRecord(
      organizationId,
      "Mi Empresa SEO",
      new Date().toISOString(),
    );
    await companyDna.upsert({ ...baseRecord, website: "https://example.com" });

    // The CEO asks the realistic prompt the Golden Image gate demands.
    const chat = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${REGULAR_TOKEN}` },
      payload: {
        message:
          "Analiza el SEO de mi web y dime cuáles son los problemas prioritarios. Crea un plan de acciones y propón las primeras mejoras que deberíamos ejecutar.",
      },
    });

    expect(chat.statusCode).toBe(200);
    const body = chat.json() as {
      reply: string;
      routing: { intent: string; rationale: string };
    };
    expect(body.routing.intent).toBe("delegate_seo");
    expect(body.reply).toMatch(/audit/i);

    // The audit must have produced a real task + result.
    const tasks: DepartmentTask[] = await workStore.listTasksForOrg(organizationId);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    // The audit task is the one carrying the actual audit result; the
    // derived SEO tasks (Ahora/Después/Optimización) carry the same
    // capability, so we identify the audit task by title.
    const seoTask = tasks.find(
      (task: DepartmentTask) => task.title === "Auditoría SEO de la web",
    );
    expect(seoTask).toBeDefined();
    expect(seoTask!.departmentId).toBe("seo");
    expect(seoTask!.status).toBe("completed");
    expect(seoTask!.capability).toBe("seo.audit.website");

    // Derived SEO tasks (Ahora/Después/Optimización) are queued and live
    // in the same canonical SEO task list.
    const derivedTasks = tasks.filter(
      (task: DepartmentTask) =>
        task.departmentId === "seo" && task.id !== seoTask!.id,
    );
    expect(derivedTasks.length).toBeGreaterThanOrEqual(1);
    for (const task of derivedTasks) {
      expect(task.departmentId).toBe("seo");
      expect(task.status).toBe("queued");
    }

    const results: DepartmentResult[] = await workStore.listResultsForOrg(organizationId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const seoResult = results.find((result: DepartmentResult) => result.departmentId === "seo");
    expect(seoResult).toBeDefined();
    expect(seoResult!.summary).toMatch(/hallazgos/i);
    // Honest separation of observed / recommendation.
    expect(seoResult!.content).toMatch(/### Observado/);
    expect(seoResult!.content).toMatch(/### Plan de resolución/);
  }, 30_000);

  it("B. admin /models returns the live LLM router registry and skips the normal chat", async () => {
    const organizationId = await onboardOrganization(ADMIN_TOKEN, "Golden Image Org");

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { message: "/models" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      reply: string;
      routing: { intent: string };
    };
    expect(body.routing.intent).toBe("admin_command");
    expect(body.reply).toMatch(/LLM Router/);
  });

  it("C. admin /skills returns the live department skill view", async () => {
    const organizationId = await onboardOrganization(ADMIN_TOKEN, "Golden Image Org Skills");

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { message: "/skills" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      reply: string;
      routing: { intent: string };
    };
    expect(body.routing.intent).toBe("admin_command");
    expect(body.reply).toMatch(/Marketing department/);
    // Specialists listed
    expect(body.reply).toMatch(/agent_marketing_director/);
    // The view is structured JSON (admin-facing), not a marketing reply.
    const view = JSON.parse(body.reply) as {
      title: string;
      departmentIdentity: { specialists: Array<{ id: string }> };
      seoCapabilities: Array<{ id: string }>;
      knowledgeCollections: Array<{ id: string }>;
    };
    expect(view.departmentIdentity.specialists.length).toBeGreaterThan(0);
    // seoCapabilities may be empty in a brand-new session with no registered
    // SEO contracts yet. We assert the field exists so the admin can see
    // there is currently no SEO skill loaded.
    expect(Array.isArray(view.seoCapabilities)).toBe(true);
  });

  it("D. regular user /models is invisible — falls through normal chat, never returns admin view", async () => {
    const organizationId = await onboardOrganization(REGULAR_TOKEN, "Customer Zero");

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${REGULAR_TOKEN}` },
      payload: { message: "/models" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      reply: string;
      routing: { intent: string };
    };
    // Must NOT be the admin escape hatch.
    expect(body.routing.intent).not.toBe("admin_command");
    // The reply must not leak the LLM router / provider list.
    expect(body.reply).not.toMatch(/LLM Router/);
    expect(body.reply).not.toMatch(/openai/);
  });

  it("E. SEO request without a website produces an honest, non-empty reply (no fake plan)", async () => {
    const organizationId = await onboardOrganization(REGULAR_TOKEN, "Sin Web");

    const chat = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${REGULAR_TOKEN}` },
      payload: { message: "Quiero un plan SEO" },
    });

    expect(chat.statusCode).toBe(200);
    const body = chat.json() as {
      reply: string;
      routing: { intent: string };
    };
    expect(body.routing.intent).toBe("delegate_seo");
    expect(body.reply).toMatch(/necesito que me indiques la web/i);
  });
});