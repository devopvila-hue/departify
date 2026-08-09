/**
 * Phase P-B — one authoritative onboarding path (K).
 *
 * The department handoff (/marketing) MUST be gated on capability/tool
 * discovery: production onboarding cannot reach it with a partial discovery.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import { InMemoryConversationStore } from "../src/customer-zero/conversation-store.js";
import { TOOL_DISCOVERY_QUESTION_IDS } from "../src/customer-zero/progressive-discovery.js";

const AUTH = { authorization: "Bearer token-a" };

describe("P-B — authoritative onboarding handoff gate", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState: new InMemoryToolStateStore(),
      conversations: new InMemoryConversationStore(),
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

  it("K. allows the handoff once every required tool-discovery question is answered", async () => {
    const organizationId = await start();
    for (const questionId of TOOL_DISCOVERY_QUESTION_IDS) {
      const answer = await server.inject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/answer`,
        headers: AUTH,
        payload: { questionId, answer: "Gmail" },
      });
      expect(answer.statusCode).toBe(200);
    }
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/marketing`,
      headers: AUTH,
    });
    expect(response.statusCode).not.toBe(409);
  });
});
