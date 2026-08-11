/**
 * Phase P-B (K) + Customer Zero P0 — one authoritative onboarding path.
 *
 * The department handoff (/marketing) is the door into the operational
 * product. It MUST be gated on the full readiness contract, not on
 * frontend progress and not on a partial discovery.
 *
 * HISTORY — why this file changed.
 *
 * The second test here used to assert that answering the tool-discovery
 * questions was ENOUGH to be let through. That assertion WAS the P0
 * defect: a company could reach the central chat having never completed
 * research, never had its Company DNA persisted, and never confirmed
 * that Departify understood it. The test now encodes the corrected
 * contract — tool discovery is necessary, never sufficient.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import { InMemoryConversationStore } from "../src/customer-zero/conversation-store.js";
import { TOOL_DISCOVERY_QUESTION_IDS } from "../src/customer-zero/progressive-discovery.js";
import { InMemoryCompanyDnaStore } from "../src/customer-zero/company-dna.js";

const AUTH = { authorization: "Bearer token-a" };

describe("P-B — authoritative onboarding handoff gate", () => {
  let server: FastifyInstance;
  let companyDna: InMemoryCompanyDnaStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    companyDna = new InMemoryCompanyDnaStore();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState: new InMemoryToolStateStore(),
      conversations: new InMemoryConversationStore(),
      companyDna,
    });
  });

  async function start(): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: AUTH,
      payload: {
        companyName: "MoOn Shared Living",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida compatible.",
        goal: "Conseguir clientes",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  async function answerToolDiscovery(organizationId: string): Promise<void> {
    for (const questionId of TOOL_DISCOVERY_QUESTION_IDS) {
      const answer = await server.inject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/answer`,
        headers: AUTH,
        payload: { questionId, answer: "Gmail" },
      });
      expect(answer.statusCode).toBe(200);
    }
  }

  it("K. blocks the handoff while capability/tool discovery is incomplete (409)", async () => {
    const organizationId = await start();
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/marketing`,
      headers: AUTH,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DISCOVERY_INCOMPLETE");
  });

  it("P0. tool discovery alone is NOT enough to enter the operational product", async () => {
    const organizationId = await start();
    await answerToolDiscovery(organizationId);

    // The company has answered every tool question, but Departify still
    // does not understand the business: research has not produced a
    // complete Company DNA and the CEO has never confirmed anything.
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/marketing`,
      headers: AUTH,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONTEXT_NOT_READY");
  });

  it("P0. the handoff opens only once the whole durable contract is satisfied", async () => {
    const organizationId = await start();
    await answerToolDiscovery(organizationId);

    // Research really completed and produced the minimum operational
    // business facts (persisted through the REAL durable store).
    const intake = await companyDna.get(organizationId);
    expect(intake).not.toBeNull();
    const now = new Date().toISOString();
    await companyDna.upsert({
      ...intake!,
      products: ["Habitaciones en pisos compartidos"],
      customers: ["Profesionales jóvenes"],
      geography: "Barcelona",
      objective: "Conseguir clientes",
      researchCompletedAt: now,
      factsUpdatedAt: now,
    });

    // The CEO confirms the understanding — the step that did not exist.
    const confirm = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/confirm`,
      headers: AUTH,
      payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().confirmed).toBe(true);

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/marketing`,
      headers: AUTH,
    });
    expect(response.statusCode).not.toBe(409);
  });

  it("P0. an existing organization is ADOPTED, never orphaned by a second tenant", async () => {
    // Company DNA is new, so organizations that onboarded before it
    // existed have no durable record. Those CEOs must complete the now
    // real confirmation step — but their Gmail tokens, conversations,
    // connections and Marketing state are keyed by organization id, so
    // handing them a brand-new tenant would silently orphan all of it.
    const fresh = new InMemoryCompanyDnaStore();
    const tenant = makeFakeTenant();
    const isolated = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState: new InMemoryToolStateStore(),
      conversations: new InMemoryConversationStore(),
      companyDna: fresh,
    });

    // user-a already owns "org-a" (pre-existing, no Company DNA).
    const existing = await tenant.listForUser("user-a");
    expect(existing.map((o) => o.organizationId)).toContain("org-a");

    const response = await isolated.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: AUTH,
      payload: {
        companyName: "Acme Solar Valencia",
        hasWebsite: false,
        description: "Instalamos paneles solares en Valencia.",
        goal: "20 reuniones/mes",
      },
    });
    expect(response.statusCode).toBe(200);

    // The SAME organization is reused, and its DNA is written there.
    expect(response.json().organizationId).toBe("org-a");
    const record = await fresh.get("org-a");
    expect(record?.companyName).toBe("Acme Solar Valencia");
    await isolated.close();
  });
});
