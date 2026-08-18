/**
 * /skills admin view — declared / registered / available / executable.
 *
 * The Golden Image gate demands /skills distinguish four states per
 * capability. This E2E test proves that, against a real built server:
 *
 *   - DECLARED  — capability-engine ships the contract (buildSeoAuditCapability)
 *   - REGISTERED — session.capabilities.register() has it
 *   - AVAILABLE — registered AND no missing tools (backing tool in Tool Runtime)
 *   - EXECUTABLE — derived state === "ready" (connection + tools + verified)
 *
 * Tests cover both admin and non-admin paths.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import { FakeTenantService } from "./helpers/fake-tenant.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import { InMemoryConversationStore } from "../src/customer-zero/conversation-store.js";
import {
  InMemoryCompanyDnaStore,
  createCompanyDnaRecord,
} from "../src/customer-zero/company-dna.js";
import { InMemoryDepartmentWorkStore } from "../src/customer-zero/department-work.js";

const ADMIN_USER = { id: "user-admin", email: "admin@example.com" };
const REGULAR_USER = { id: "user-customer", email: "customer@example.com" };
const ADMIN_TOKEN = "token-admin";
const REGULAR_TOKEN = "token-customer";

const ORIGINAL_ENV = { ...process.env };

describe("/skills admin view — SEO capability states", () => {
  let server: FastifyInstance;
  let companyDna: InMemoryCompanyDnaStore;
  let workStore: InMemoryDepartmentWorkStore;

  beforeAll(async () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "1";
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = ADMIN_USER.id;

    workStore = new InMemoryDepartmentWorkStore();
    companyDna = new InMemoryCompanyDnaStore();

    const tenant = new FakeTenantService({
      users: [
        [ADMIN_TOKEN, ADMIN_USER],
        [REGULAR_TOKEN, REGULAR_USER],
      ],
      memberships: [],
    });

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

  async function onboard(userToken: string, name: string): Promise<string> {
    const create = await server.inject({
      method: "POST",
      url: "/api/auth/organizations",
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name },
    });
    expect(create.statusCode).toBe(201);
    return (create.json() as { organizationId: string }).organizationId;
  }

  it("admin /skills surfaces declared + registered + executable SEO capabilities", async () => {
    const organizationId = await onboard(ADMIN_TOKEN, "Golden Image SEO State");

    // Plant a website so the audit capability can become executable once
    // verified (here it stays "validating" because the audit has not run).
    const baseRecord = createCompanyDnaRecord(
      organizationId,
      "Golden Image SEO State",
      new Date().toISOString(),
    );
    await companyDna.upsert({ ...baseRecord, website: "https://example.com" });

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { message: "/skills" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { reply: string; routing: { intent: string } };
    expect(body.routing.intent).toBe("admin_command");
    const view = JSON.parse(body.reply) as {
      seoCapabilities: Array<{
        id: string;
        registered: boolean;
        available: boolean;
        executable: boolean;
        status: string;
        requiredConnections: string[];
        requiredTools: string[];
        missingConnections: string[];
        missingTools: string[];
        verification: { status: string; verifiedAt: string | null; checks: string[] };
      }>;
    };

    // Both declared IDs must be present (one of the four states per id).
    expect(view.seoCapabilities.map((c) => c.id).sort()).toEqual([
      "seo.audit.website",
      "seo.repository.read",
    ]);

    const audit = view.seoCapabilities.find((c) => c.id === "seo.audit.website")!;
    expect(audit.registered).toBe(true);
    expect(audit.available).toBe(true);
    // The audit tool is registered in the Tool Runtime at session startup,
    // so isToolAvailable(toolId) returns true → no missing tools.
    expect(audit.missingTools).toEqual([]);
    // No required connections for the audit (it fetches the public URL).
    expect(audit.requiredConnections).toEqual([]);
    // Verification is pending — the audit has not been called yet.
    expect(audit.verification.status).toBe("pending");
    expect(audit.executable).toBe(false); // not verified → not ready
    expect(audit.status).toMatch(/validating|registered/);

    const repoRead = view.seoCapabilities.find((c) => c.id === "seo.repository.read")!;
    expect(repoRead.registered).toBe(true);
    expect(repoRead.requiredConnections).toEqual(["github_repository"]);
    // Without a github_repository connection the missing list is non-empty.
    expect(repoRead.missingConnections).toContain("github_repository");
  });

  it("regular user /skills returns normal chat — never leaks capability infrastructure", async () => {
    const organizationId = await onboard(REGULAR_TOKEN, "Customer Zero SEO State");
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: `Bearer ${REGULAR_TOKEN}` },
      payload: { message: "/skills" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { reply: string; routing: { intent: string } };
    // Must NOT be the admin escape hatch.
    expect(body.routing.intent).not.toBe("admin_command");
    // The reply must not leak any capability / runtime / provider info.
    expect(body.reply).not.toMatch(/Marketing department/);
    expect(body.reply).not.toMatch(/seo\.audit/);
    expect(body.reply).not.toMatch(/openai/);
    expect(body.reply).not.toMatch(/provider/i);
  });
});