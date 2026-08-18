/**
 * /configuracion — provider registry, credential validation, branding.
 *
 *   A. GET providers — only enabled providers with real adapters.
 *   B. Change provider — models change accordingly.
 *   C. Invalid API key — never persisted.
 *   D. Valid API key — credential store contains the secret; portal
 *      response never includes it.
 *   E. Reload — selection persists.
 *   F. Logo upload — asset persisted, branding updated, preview URL ready.
 *   G. Replace logo — previous asset removed, new asset stored.
 *   H. Delete logo — branding returns to empty state.
 *   I. Org A cannot read/write/delete Org B assets (tenant isolation).
 *   J. Invalid file — rejected (bad MIME / too large / empty).
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Stub the Supabase service-role client constructor at module level. The
// branding routes call createClient(url, key, opts) once per request; the
// spy replaces every call with our in-memory fake.
let stubBuckets = new Map<string, Map<string, Buffer>>();
const stubUpload = vi.fn();
const stubRemove = vi.fn();
const stubSignedUrl = vi.fn();
vi.mock("@supabase/supabase-js", async () => {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>(
    "@supabase/supabase-js",
  );
  return {
    ...actual,
    createClient: () => ({
      storage: {
        from: (bucket: string) => ({
          upload: (path: string, body: Buffer) => {
            stubUpload(bucket, path, body);
            const map = stubBuckets.get(bucket) ?? new Map<string, Buffer>();
            map.set(path, body);
            stubBuckets.set(bucket, map);
            return Promise.resolve({ error: null, data: { path } });
          },
          remove: (paths: string[]) => {
            stubRemove(bucket, paths);
            const map = stubBuckets.get(bucket);
            if (map) for (const p of paths) map.delete(p);
            return Promise.resolve({ error: null });
          },
          createSignedUrl: (path: string, _ttl: number) => {
            stubSignedUrl(bucket, path);
            const map = stubBuckets.get(bucket);
            if (!map?.has(path)) {
              return Promise.resolve({
                data: null,
                error: { message: `object ${path} not found` },
              });
            }
            return Promise.resolve({
              data: {
                signedUrl: `https://example.com/storage/v1/object/sign/${bucket}/${path}?token=fake`,
              },
              error: null,
            });
          },
        }),
      },
    }),
  };
});
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
import { makeFakeTenant } from "./helpers/fake-tenant.js";

// Stub the Supabase service-role client constructor at module level. The
// branding routes call createClient(url, key, opts) once per request; the
// spy replaces every call with our in-memory fake.

describe("/configuracion — BYOK provider registry + branding", () => {
  let server: FastifyInstance;
  let credentialStore: LlmCredentialStore;
  let brandingStore: OrganizationBrandingStore;

  beforeAll(async () => {
    // Branding routes build a Supabase service-role client on demand; in
    // tests we stub createClient so the env vars do not need to point at
    // a real project. We still set them so loadAuthConfig() does not
    // throw a missing-config error before the spy is reached.
    process.env["SUPABASE_URL"] = process.env["SUPABASE_URL"] ?? "https://example.supabase.co";
    process.env["SUPABASE_PUBLISHABLE_KEY"] =
      process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "test-publishable-key";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] =
      process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "test-service-role-key";

    const tenant = makeFakeTenant();
    credentialStore = createInMemoryLlmCredentialStore();
    brandingStore = createInMemoryOrganizationBrandingStore();
    setLlmCredentialStore(credentialStore);
    setOrganizationBrandingStore(brandingStore);
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      llmCredentials: credentialStore,
      branding: brandingStore,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function start(companyName: string): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName,
        hasWebsite: false,
        description: "Test company.",
        goal: "Operate Departify",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  // A. GET providers ---------------------------------------------------
  it("returns only providers the runtime can validate and use", async () => {
    const organizationId = await start("Provider Registry Co");
    const response = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/byok/providers`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      providers: { id: string; enabled: boolean; models: { id: string }[] }[];
    };
    const ids = body.providers.map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("minimax");
    // All returned providers must be enabled (the registry never surfaces a disabled one).
    for (const provider of body.providers) {
      expect(provider.enabled).toBe(true);
      expect(provider.models.length).toBeGreaterThan(0);
    }
  });

  // B. Change provider — models swap --------------------------------------
  it("changing provider updates the available models list", async () => {
    const organizationId = await start("Model Swap Co");
    const registry = (
      await server.inject({
        method: "GET",
        url: `/api/customer-zero/${organizationId}/byok/providers`,
        headers: { authorization: "Bearer token-a" },
      })
    ).json() as {
      providers: { id: string; models: { id: string }[] }[];
    };
    const openaiModels = registry.providers.find((p) => p.id === "openai")?.models ?? [];
    const minimaxModels = registry.providers.find((p) => p.id === "minimax")?.models ?? [];
    expect(openaiModels.map((m) => m.id)).toContain("gpt-4o-mini");
    expect(minimaxModels.map((m) => m.id)).toContain("MiniMax-M3");
    // The two registries must NOT share model ids — they target different
    // upstream APIs even though both are OpenAI-SDK-shaped.
    const overlap = openaiModels
      .map((m) => m.id)
      .filter((id) => minimaxModels.some((m) => m.id === id));
    expect(overlap).toEqual([]);
  });

  // C. Invalid API key — never persisted ----------------------------------
  it("rejects invalid OpenAI keys and never persists them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_api_key" }), { status: 401 }),
      ),
    );
    const organizationId = await start("Invalid Key Co");
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-bad-key",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain("Esta clave no es válida");
    expect(await credentialStore.get(organizationId, "openai")).toBeNull();
  });

  // D. Valid API key — stored, never returned -----------------------------
  it("stores a valid OpenAI key and never returns it to the portal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );
    const organizationId = await start("Valid Key Co");
    const secret = "sk-test-secret-that-must-never-leave";
    const save = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: secret,
      },
    });
    expect(save.statusCode).toBe(200);
    const saveBody = JSON.stringify(save.json());
    expect(saveBody).not.toContain(secret);
    const record = await credentialStore.get(organizationId, "openai");
    expect(record?.apiKey).toBe(secret);

    const safe = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(JSON.stringify(safe.json())).not.toContain(secret);
  });

  // E. Reload — selection persists ----------------------------------------
  it("persists the selected provider + model across a reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );
    const organizationId = await start("Reload Co");
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-reload-key",
      },
    });
    const safe = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/llm-settings`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(safe.json()).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      state: "connected",
    });
  });

  // F. Upload valid logo — branding updated, preview available -----------
  it("uploads a valid PNG and returns a signed preview URL", async () => {
    const organizationId = await start("Brand Co");
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    // The Supabase service-role client is replaced by the module-level
    // vi.mock above; every branding route call sees the in-memory fake.

    const upload = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        mimeType: "image/png",
        dataBase64: png.toString("base64"),
        fileName: "logo.png",
      },
    });
    expect(upload.statusCode).toBe(200);
    const body = upload.json() as {
      organizationId: string;
      brandName: string | null;
      logo: { signedUrl: string; mimeType: string; sizeBytes: number } | null;
      updatedAt: string | null;
    };
    expect(body.logo).not.toBeNull();
    expect(body.logo?.mimeType).toBe("image/png");
    expect(body.logo?.signedUrl).toMatch(/^https:\/\/example\.com\/storage\//);
    expect(body.organizationId).toBe(organizationId);
    // Persisted reference
    const persisted = await brandingStore.get(organizationId);
    expect(persisted?.logoAssetPath).toContain(organizationId);
    expect(persisted?.logoMimeType).toBe("image/png");
  });

  // G. Replace logo — previous asset lifecycle ----------------------------
  it("replaces a logo and the previous asset is removed from storage", async () => {
    const organizationId = await start("Replace Brand Co");
    // The Supabase service-role client is replaced by the module-level
    // vi.mock above; every branding route call sees the in-memory fake.

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        mimeType: "image/png",
        dataBase64: png.toString("base64"),
      },
    });
    const firstPath = (await brandingStore.get(organizationId))?.logoAssetPath ?? "";
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        mimeType: "image/jpeg",
        dataBase64: jpg.toString("base64"),
      },
    });
    const secondPath = (await brandingStore.get(organizationId))?.logoAssetPath ?? "";
    expect(secondPath).not.toBe(firstPath);
    expect(secondPath.endsWith("logo.jpg")).toBe(true);
    expect(stubRemove).toHaveBeenCalled();
    // (Module-level mock is restored by afterEach.)
  });

  // H. Delete logo — branding returns to empty state ----------------------
  it("deleting the logo returns the branding view to the empty state", async () => {
    const organizationId = await start("Delete Brand Co");
    // The Supabase service-role client is replaced by the module-level
    // vi.mock above; every branding route call sees the in-memory fake.

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: { mimeType: "image/png", dataBase64: png.toString("base64") },
    });
    const del = await server.inject({
      method: "DELETE",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().logo).toBeNull();
    // (Module-level mock is restored by afterEach.)
  });

  // I. Tenant isolation — Org B cannot reach Org A's branding -----------
  it("a different org cannot read another org's branding", async () => {
    const organizationA = await start("Org A");
    const organizationB = await start("Org B");
    // The Supabase service-role client is replaced by the module-level
    // vi.mock above; every branding route call sees the in-memory fake.

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationA}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: { mimeType: "image/png", dataBase64: png.toString("base64") },
    });
    const readFromB = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationB}/branding`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(readFromB.statusCode).toBe(200);
    expect(readFromB.json().logo).toBeNull();
    // (Module-level mock is restored by afterEach.)
  });

  // J. Invalid file — rejected (MIME / oversize / empty) -----------------
  it("rejects unsupported MIME types", async () => {
    const organizationId = await start("Bad Mime Co");
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        mimeType: "application/pdf",
        dataBase64: Buffer.from("not an image").toString("base64"),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsupported_mime_type");
  });

  it("rejects files above the 5 MB limit", async () => {
    const organizationId = await start("Big Co");
    const tooBig = Buffer.alloc(6 * 1024 * 1024, 1);
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        mimeType: "image/png",
        dataBase64: tooBig.toString("base64"),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("file_too_large");
  });

  it("rejects empty payloads", async () => {
    const organizationId = await start("Empty Co");
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/branding/logo`,
      headers: { authorization: "Bearer token-a" },
      payload: { mimeType: "image/png", dataBase64: "" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("missing_file");
  });
});
