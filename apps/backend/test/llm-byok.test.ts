import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { loadBackendConfig } from "@departify/config";
import { buildServer } from "../src/server/server.js";
import {
  createInMemoryLlmCredentialStore,
  type LlmCredentialStore,
} from "../src/customer-zero/llm-credentials.js";
import { makeFakeTenant } from "./helpers/fake-tenant.js";

describe("organization BYOK", () => {
  let server: FastifyInstance;
  let store: LlmCredentialStore;

  beforeAll(async () => {
    store = createInMemoryLlmCredentialStore();
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      llmCredentials: store,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function start(): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "BYOK Co",
        hasWebsite: false,
        description: "Una empresa de prueba.",
        goal: "Trabajar mejor",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  it("returns guided safe metadata without exposing a credential", async () => {
    const organizationId = await start();
    const response = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "openai",
      providerName: "OpenAI",
      state: "needs_setup",
      help: {
        actionUrl: "https://platform.openai.com/api-keys",
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("apiKey");
  });

  it("validates, stores and reports a real connected BYOK credential safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    const organizationId = await start();
    const secret = "sk-test-secret-that-never-leaves-the-server";
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
      payload: { provider: "openai", model: "gpt-4o-mini", apiKey: secret },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "connected", configured: true });
    expect(JSON.stringify(response.json())).not.toContain(secret);

    const record = await store.get(organizationId, "openai");
    expect(record?.apiKey).toBe(secret);

    const safe = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(JSON.stringify(safe.json())).not.toContain(secret);
    expect(safe.json().state).toBe("connected");
  });

  it("humanizes invalid keys and preserves tenant isolation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401 })),
    );
    const organizationId = await start();
    const invalid = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
      payload: { provider: "openai", model: "gpt-4o-mini", apiKey: "not-valid" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.message).toContain("No hemos podido validar");
    expect(await store.get(organizationId, "openai")).toBeNull();

    const forbidden = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-b" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
