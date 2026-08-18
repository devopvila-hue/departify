import { beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { createInMemoryLlmCredentialStore, LlmCredentialStore, setLlmCredentialStore } from "../src/customer-zero/llm-credentials.js";
import { GoogleTokenStore, createInMemoryGoogleTokenStore, setGoogleTokenStore } from "../src/customer-zero/google-tokens.js";

describe("departify-video runtime and job contract tests", () => {
  let server: FastifyInstance;
  let llmCredentials: LlmCredentialStore;
  let googleTokens: GoogleTokenStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    llmCredentials = createInMemoryLlmCredentialStore();
    googleTokens = createInMemoryGoogleTokenStore();

    setLlmCredentialStore(llmCredentials);
    setGoogleTokenStore(googleTokens);

    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      llmCredentials,
      googleTokens,
    });
  });

  it("Video BYOK missing blocker: returns clean humanized credential needed message", async () => {
    // 1. Start session
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Video Corp",
        hasWebsite: false,
        description: "Video production company.",
        goal: "Generate highly engaging business videos",
      },
    });
    expect(start.statusCode).toBe(200);
    const org = start.json().organizationId as string;

    // 2. Try to generate video without configuring OpenAI apiKey
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        prompt: "Create a promo video about growing B2B sales",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VIDEO_BYOK_MISSING");
    expect(response.json().error.message).toContain("Para crear vídeos necesitas conectar tu clave de OpenAI");
  });

  it("Google Drive write missing blocker: returns clean humanized Drive needed message", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Video Corp 2",
        hasWebsite: false,
        description: "Video production company.",
        goal: "Generate videos",
      },
    });
    const org = start.json().organizationId as string;

    // Set OpenAI apiKey (BYOK)
    await llmCredentials.put({
      organizationId: org,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key-for-video-test",
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    // Try to generate video without Google Drive connected for writing
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        prompt: "Create a product reveal video",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("GOOGLE_DRIVE_MISSING");
    expect(response.json().error.message).toContain("Google Drive todavía no está conectado para escritura");
  });

  it("VideoJob creation and queue: succeeds in creating and polling the VideoJob asynchronously", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Video Corp 3",
        hasWebsite: false,
        description: "Video production.",
        goal: "Generate videos",
      },
    });
    const org = start.json().organizationId as string;

    // Connect OpenAI BYOK
    await llmCredentials.put({
      organizationId: org,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key-for-video-test",
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    // Connect Google Drive write
    await googleTokens.put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      scopes: ["https://www.googleapis.com/auth/drive.file"], // write scope!
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: "ceo@videocorp.com",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.write"],
    });

    // Trigger video generation
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        prompt: "Create an Instagram video about lead generation",
        aspectRatio: "9:16",
        duration: 15,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("queued");
    expect(response.json().job.id).toBeDefined();
    expect(response.json().job.prompt).toBe("Create an Instagram video about lead generation");
    expect(response.json().job.aspectRatio).toBe("9:16");
    expect(response.json().job.duration).toBe(15);

    const jobId = response.json().job.id as string;

    // Poll the VideoJob status
    const poll = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/video/jobs/${jobId}`,
      headers: { authorization: "Bearer token-a" },
    });

    expect(poll.statusCode).toBe(200);
    expect(poll.json().job.status).toBeDefined();
    expect(poll.json().job.progress).toBeDefined();
  });
});
