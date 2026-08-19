/**
 * SEO capability certification — Customer Zero Golden Image gate.
 *
 * Proves the canonical certification pattern: a capability is registered
 * with `verification.status === "pending"`; after a REAL round-trip
 * succeeds, `runDelegateSeoTurn` flips it to `"passed"` via
 * `certifySeoCapability` (the same canonical helper used by Mautic).
 *
 *   seo.audit.website   → certified only when auditWebsite() succeeds.
 *   seo.repository.read → certified only when inspectGithubRepository()
 *                          returns a real inspection. NEVER on connection
 *                          alone, NEVER on token presence alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDelegateSeoTurn } from "../src/server/routes/customer-zero-v2.js";
import {
  InMemoryCompanyDnaStore,
  createCompanyDnaRecord,
} from "../src/customer-zero/company-dna.js";
import {
  setExternalOAuthTokenStore,
  type ExternalOAuthTokenRecord,
  type ExternalOAuthTokenStore,
} from "../src/customer-zero/external-oauth-tokens.js";
import {
  setSeoRepositoryLinkStore,
  type InMemorySeoRepositoryLinkStore,
} from "../src/customer-zero/seo-repository.js";
import { __resetWorkStoreForTests } from "../src/server/routes/customer-zero-v2.js";
import { resetFallbackCompanyDnaStoreForTest } from "../src/customer-zero/company-dna.js";
import type { CustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";
import {
  DepartmentCapabilityRegistry,
  buildSeoAuditCapability,
  buildSeoRepositoryReadCapability,
  SEO_AUDIT_CAPABILITY_ID,
  SEO_REPOSITORY_READ_CAPABILITY_ID,
} from "@departify/capability-engine";

class FakeOAuthTokenStore implements ExternalOAuthTokenStore {
  private records = new Map<string, ExternalOAuthTokenRecord>();
  async put(record: ExternalOAuthTokenRecord): Promise<void> {
    this.records.set(`${record.organizationId}:${record.userId}:${record.provider}`, record);
  }
  async get(o: string, u: string, p: "github"): Promise<ExternalOAuthTokenRecord | null> {
    return this.records.get(`${o}:${u}:${p}`) ?? null;
  }
  async listForOrg(): Promise<never[]> {
    return [];
  }
  async remove(o: string, u: string, p: "github"): Promise<void> {
    this.records.delete(`${o}:${u}:${p}`);
  }
}

function emptySession(): CustomerZeroSession {
  // Build a session with a capabilities registry that mirrors what
  // customer-zero-session.ts sets up in production: both SEO contracts
  // are pre-registered (so capability.get() returns them).
  const capabilities = new DepartmentCapabilityRegistry();
  capabilities.register(buildSeoAuditCapability());
  capabilities.register(buildSeoRepositoryReadCapability());
  return {
    organizationId: "org_seo_cert",
    state: {
      connections: new Map(),
      locale: "es",
    },
    capabilities,
  } as unknown as CustomerZeroSession;
}

const ORG = "org_seo_cert";
const USER = "user_seo_cert";
const REPO_FULL = "acme/marketing-site";
const WEBSITE = "https://example.com";

describe("SEO capability certification", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    resetFallbackCompanyDnaStoreForTest();
    __resetWorkStoreForTests();
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/sitemap.xml")) {
        return new Response("not found", { status: 404 });
      }
      if (url.startsWith(WEBSITE)) {
        return new Response(
          `<html><head><title>Acme</title><meta name="description" content="x"></head><body><h1>Hola</h1></body></html>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.startsWith("https://api.github.com/")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer ghp_test");
        return new Response(
          JSON.stringify({
            tree: [
              { path: "next.config.js", type: "blob" },
              { path: "public/sitemap.xml", type: "blob" },
              { path: "src/app/layout.tsx", type: "blob" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetFallbackCompanyDnaStoreForTest();
    __resetWorkStoreForTests();
  });

  it("certifies seo.audit.website after a real auditWebsite success", async () => {
    const session = emptySession();
    const before = session.capabilities.get(SEO_AUDIT_CAPABILITY_ID)!;
    expect(before.verification.status).toBe("pending");

    const dnaStore = new InMemoryCompanyDnaStore();
    const baseRecord = createCompanyDnaRecord(
      ORG,
      "Acme",
      new Date().toISOString(),
    );
    await dnaStore.upsert({ ...baseRecord, website: WEBSITE });

    const reply = await runDelegateSeoTurn(
      session,
      ORG,
      { companyDna: dnaStore },
      { userId: USER },
    );

    expect(reply.reply).toMatch(/He auditado/);
    const after = session.capabilities.get(SEO_AUDIT_CAPABILITY_ID)!;
    expect(after.verification.status).toBe("passed");
    expect(after.verification.verifiedAt).toBeTruthy();
  });

  it("certifies seo.repository.read ONLY when a real GitHub inspection succeeds", async () => {
    const session = emptySession();

    // Plant OAuth token + repo link.
    const tokenStore = new FakeOAuthTokenStore();
    await tokenStore.put({
      organizationId: ORG,
      userId: USER,
      provider: "github",
      accessToken: "ghp_test",
      refreshToken: null,
      expiresAt: null,
      scopes: ["repo", "read:user"],
      accountLabel: "acme-bot",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
    });
    setExternalOAuthTokenStore(tokenStore);

    const linkStoreModule = await import("../src/customer-zero/seo-repository.js");
    const linkStore: InMemorySeoRepositoryLinkStore =
      new linkStoreModule.InMemorySeoRepositoryLinkStore();
    setSeoRepositoryLinkStore(linkStore);
    await linkStore.upsert({
      organizationId: ORG,
      departmentId: "seo",
      website: WEBSITE,
      provider: "github",
      repositoryId: "1",
      repositoryFullName: REPO_FULL,
      defaultBranch: "main",
      access: "read",
      selectedBy: USER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const dnaStore = new InMemoryCompanyDnaStore();
    const baseRecord = createCompanyDnaRecord(ORG, "Acme", new Date().toISOString());
    await dnaStore.upsert({ ...baseRecord, website: WEBSITE });

    const before = session.capabilities.get(SEO_REPOSITORY_READ_CAPABILITY_ID)!;
    expect(before.verification.status).toBe("pending");

    const reply = await runDelegateSeoTurn(
      session,
      ORG,
      { companyDna: dnaStore },
      { userId: USER },
    );
    expect(reply.reply).toMatch(/He auditado/);

    const after = session.capabilities.get(SEO_REPOSITORY_READ_CAPABILITY_ID)!;
    expect(after.verification.status).toBe("passed");
    expect(after.verification.verifiedAt).toBeTruthy();
  });

  it("does NOT certify seo.repository.read when only OAuth token is present but no link is set", async () => {
    const session = emptySession();

    // OAuth token present, but no SeoRepositoryLink for this org.
    const tokenStore = new FakeOAuthTokenStore();
    await tokenStore.put({
      organizationId: ORG,
      userId: USER,
      provider: "github",
      accessToken: "ghp_test",
      refreshToken: null,
      expiresAt: null,
      scopes: ["repo"],
      accountLabel: "acme-bot",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
    });
    setExternalOAuthTokenStore(tokenStore);
    const linkStoreModule = await import("../src/customer-zero/seo-repository.js");
    setSeoRepositoryLinkStore(new linkStoreModule.InMemorySeoRepositoryLinkStore());

    const dnaStore = new InMemoryCompanyDnaStore();
    const baseRecord = createCompanyDnaRecord(ORG, "Acme", new Date().toISOString());
    await dnaStore.upsert({ ...baseRecord, website: WEBSITE });

    await runDelegateSeoTurn(
      session,
      ORG,
      { companyDna: dnaStore },
      { userId: USER },
    );

    const after = session.capabilities.get(SEO_REPOSITORY_READ_CAPABILITY_ID)!;
    expect(after.verification.status).toBe("pending");
  });
});