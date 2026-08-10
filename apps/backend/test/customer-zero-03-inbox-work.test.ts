import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryInboxStore } from "../src/customer-zero/inbox-domain.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";

/**
 * CZ03 — Inbox → work bridge.
 *
 * A classified InboxItem becomes a durable DepartmentTask through the
 * existing work store; the item is linked (relatedWorkItemId + state
 * `in_work`). The bridge reuses the task/approval/result infrastructure —
 * no new inbox runtime.
 */

const AUTH = { authorization: "Bearer token-a" };

describe("CZ03 — Inbox → work bridge", () => {
  let server: FastifyInstance;
  let inboxStore: InMemoryInboxStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    inboxStore = new InMemoryInboxStore();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      inbox: inboxStore,
    });
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  async function startOrg(): Promise<string> {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  async function seedLeadItem(org: string): Promise<string> {
    const item = await inboxStore.upsert({
      organizationId: org,
      source: "gmail",
      sourceMessageId: "msg_lead_1",
      channel: "email",
      category: "lead",
      subject: "Consulta pricing",
      sender: { email: "cliente@acme.com", displayName: "Cliente" },
      recipients: [{ email: "ceo@departify.app" }],
      plainText: "Me interesa vuestro servicio",
      preview: "Me interesa vuestro servicio",
      receivedAt: new Date().toISOString(),
      unread: true,
      importance: 0.85,
      departmentId: "marketing",
      isLead: true,
      relatedWorkItemId: null,
      relatedConversationId: null,
      provenance: { provider: "gmail", rawEventId: "msg_lead_1" },
      state: "classified",
    });
    return item.id;
  }

  it("converts a lead InboxItem into a durable DepartmentTask", async () => {
    const org = await startOrg();
    const itemId = await seedLeadItem(org);
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/${itemId}/work`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task.organizationId).toBe(org);
    expect(body.task.title).toContain("Oportunidad de cliente");
    expect(body.task.status).toBe("queued");
    // The item is now linked and in_work.
    expect(body.item.state).toBe("in_work");
    expect(body.item.relatedWorkItemId).toBe(body.task.id);
  });

  it("rejects a work bridge for an item from another org", async () => {
    const org = await startOrg();
    const itemId = await seedLeadItem(org);
    // user-b tries to convert user-a's item.
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/${itemId}/work`,
      headers: { authorization: "Bearer token-b" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns 404 for a missing item", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/missing-item/work`,
    });
    expect(response.statusCode).toBe(404);
  });
});
