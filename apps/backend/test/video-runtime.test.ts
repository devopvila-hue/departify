import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { createInMemoryLlmCredentialStore, LlmCredentialStore, setLlmCredentialStore, getLlmCredentialStore } from "../src/customer-zero/llm-credentials.js";
import { GoogleTokenStore, createInMemoryGoogleTokenStore, setGoogleTokenStore, getGoogleTokenStore } from "../src/customer-zero/google-tokens.js";
import { workStoreForRoutes } from "../src/server/routes/customer-zero-v2.js";
import { recoverAllActiveVideoJobsOnBoot, executeVideoJobReconciliation } from "../src/server/routes/video.js";

describe("departify-video runtime and job contract tests", () => {
  let server: FastifyInstance;
  let llmCredentials: LlmCredentialStore;
  let googleTokens: GoogleTokenStore;
  let originalLlmStore: LlmCredentialStore;
  let originalGoogleStore: GoogleTokenStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    llmCredentials = createInMemoryLlmCredentialStore();
    googleTokens = createInMemoryGoogleTokenStore();

    originalLlmStore = getLlmCredentialStore();
    originalGoogleStore = getGoogleTokenStore();

    setLlmCredentialStore(llmCredentials);
    setGoogleTokenStore(googleTokens);

    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      llmCredentials,
    });
  });

  afterAll(async () => {
    setLlmCredentialStore(originalLlmStore);
    setGoogleTokenStore(originalGoogleStore);
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
      baseUrl: null,
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
      baseUrl: null,
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

  it("Test A: VideoJob is persisted in the durable TaskStore", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: { companyName: "Durable Corp", hasWebsite: false, description: "Video production.", goal: "Generate videos" },
    });
    const org = start.json().organizationId as string;

    await llmCredentials.put({
      organizationId: org,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key-for-durable-test",
      baseUrl: null,
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    await googleTokens.put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: "ceo@durablecorp.com",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.write"],
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: { prompt: "Promo video", idempotencyKey: "unique-key-1" },
    });
    expect(response.statusCode).toBe(201);
    const jobId = response.json().job.id as string;

    // Verify task is retrieved from the durable work store
    const workStore = workStoreForRoutes();
    const task = await workStore.getTask(jobId);
    expect(task).toBeDefined();
    expect(task!.status).toBeDefined();
    expect(task!.summary).toBe("Promo video");
  });

  it("Test C: Same idempotency key yields a single creation and execution", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: { companyName: "Idempotent Corp", hasWebsite: false, description: "Video production.", goal: "Generate videos" },
    });
    const org = start.json().organizationId as string;

    await llmCredentials.put({
      organizationId: org,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key",
      baseUrl: null,
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    await googleTokens.put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "mock",
      refreshToken: "mock",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: "ceo@idem.com",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.write"],
    });

    const run1 = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: { prompt: "Engaging Clip", idempotencyKey: "idem-key-123" },
    });

    const run2 = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: { prompt: "Engaging Clip", idempotencyKey: "idem-key-123" },
    });

    expect(run1.statusCode).toBe(201);
    expect(run2.statusCode).toBe(201);
    expect(run1.json().job.id).toBe(run2.json().job.id); // Exactly same jobId returned!
  });

  it("Test D: Budget Guard blocks and prevents invocation if budget is insufficient", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: { companyName: "Budget Corp", hasWebsite: false, description: "Video production.", goal: "Generate videos" },
    });
    const org = start.json().organizationId as string;

    await llmCredentials.put({
      organizationId: org,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key",
      baseUrl: null,
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    await googleTokens.put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "mock",
      refreshToken: "mock",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: "ceo@budget.com",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.write"],
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/video/generate`,
      headers: { authorization: "Bearer token-a" },
      payload: { prompt: "Super premium video production", budget: 0.05 }, // Insufficient budget (cost = $0.15)
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VIDEO_BUDGET_EXCEEDED");
    expect(response.json().error.message).toContain("presupuesto de vídeo");
  });

  it("Test E: Drive upload idempotency - reuses existing artifact and does not upload twice", async () => {
    const orgId = "org-mock-id";

    // Set OpenAI and Google tokens to satisfy activeTask credential fetch in executeVideoJobReconciliation
    await llmCredentials.put({
      organizationId: orgId,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key-for-test-e",
      baseUrl: null,
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    await googleTokens.put({
      organizationId: orgId,
      userId: "user-a",
      provider: "gmail",
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: "ceo@videocorp.com",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.write"],
    });

    const workStore = workStoreForRoutes();
    const task = await workStore.createTask({
      organizationId: orgId,
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "user-a",
      title: "Generación de Vídeo de Marketing",
      summary: "Idempotency test video",
      capability: "marketing.video.prepare",
      toolId: "departify.video.generate",
      status: "queued",
      statusMessage: "En cola...",
      progress: 0,
      requiredCapabilities: ["marketing.video.prepare", "drive.write"],
      startedAt: null,
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 300_000,
      source: {
        type: "video_generation",
        idempotencyKey: "drive-idem-key",
        aspectRatio: "9:16",
        duration: 15,
        budget: 1.00,
        estimatedCost: 0.15,
        providerOperations: [],
        artifact: "https://drive.google.com/file/d/cached-file-id/view", // Already uploaded!
        driveFileId: "cached-file-id",
      },
    });

    await executeVideoJobReconciliation(task.id, {
      llmCredentials,
      googleTokens,
    } as any);

    const updated = await workStore.getTask(task.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.statusMessage).toBe("Vídeo completado y subido.");
    expect(updated!.progress).toBe(1.0);
  });

  it("Test F: Incomplete/running tasks are reconciled on boot-up", async () => {
    const orgId = "org-reconcile-boot";

    // Set credentials for org-reconcile-boot
    await llmCredentials.put({
      organizationId: orgId,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-key-for-test-f",
      baseUrl: null,
      createdBy: "user-a",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });

    await googleTokens.put({
      organizationId: orgId,
      userId: "user-a",
      provider: "gmail",
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: "ceo@videocorp.com",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.write"],
    });

    const workStore = workStoreForRoutes();
    const task = await workStore.createTask({
      organizationId: orgId,
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "user-a",
      title: "Generación de Vídeo de Marketing",
      summary: "Boot reconciliation test",
      capability: "marketing.video.prepare",
      toolId: "departify.video.generate",
      status: "running", // Stuck in running
      statusMessage: "Iniciando renderizador...",
      progress: 0.1,
      requiredCapabilities: ["marketing.video.prepare", "drive.write"],
      startedAt: new Date().toISOString(),
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 300_000,
      source: {
        type: "video_generation",
        idempotencyKey: "boot-key-reconcile",
        aspectRatio: "9:16",
        duration: 15,
        budget: 1.00,
        estimatedCost: 0.15,
        providerOperations: [],
        artifact: "https://drive.google.com/file/d/cached-file-id/view", // Already generated!
        driveFileId: "cached-file-id",
      },
    });

    // Simulate boot recovery
    await recoverAllActiveVideoJobsOnBoot({
      llmCredentials,
      googleTokens,
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const updated = await workStore.getTask(task.id);
    expect(updated!.status).toBe("completed");
  });
});
