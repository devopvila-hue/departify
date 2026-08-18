/**
 * Web ↔ Repository correlation — Customer Zero Golden Image gate.
 *
 * Proves the Customer Zero honesty contract end to end:
 *
 *   1. auditWebsite() runs against a real public URL.
 *   2. inspectGithubRepository() reads the SEO-selected repository.
 *   3. buildSeoCorrelation() produces structured sections, one per audit
 *      issue that has matching file hints in the repository.
 *   4. renderSeoCorrelationMarkdown() emits OBSERVED / INFERRED /
 *      RECOMMENDED sections — never presenting an inference as observed.
 *
 * The HTTP boundary is stubbed because the test environment has no
 * network. Every other step is the real production code path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditWebsite } from "../src/customer-zero/seo-audit.js";
import {
  buildSeoCorrelation,
  inspectGithubRepository,
  renderSeoCorrelationMarkdown,
  setSeoRepositoryLinkStore,
  type InMemorySeoRepositoryLinkStore,
  type SeoRepositoryInspection,
} from "../src/customer-zero/seo-repository.js";
import {
  setExternalOAuthTokenStore,
  type ExternalOAuthTokenRecord,
  type ExternalOAuthTokenStore,
} from "../src/customer-zero/external-oauth-tokens.js";

const ORG = "org_seo_correlation";
const USER = "user_seo_correlation";
const WEBSITE = "https://acme.example";
const REPO_FULL = "acme/marketing-site";

const PAGE_HTML = `<!doctype html>
<html>
<head>
  <title>Acme — Productos</title>
  <meta name="description" content="Catálogo de productos Acme.">
  <link rel="canonical" href="https://acme.example/">
</head>
<body>
  <h1>Bienvenido a Acme</h1>
  <h2>Catálogo</h2>
  <h3>Top ventas</h3>
  <img src="/hero.jpg">
  <a href="/productos">Productos</a>
  <a href="/empresa">Empresa</a>
</body>
</html>`;

const REPO_TREE_RESPONSE = {
  tree: [
    { path: "next.config.js", type: "blob" },
    { path: "public/robots.txt", type: "blob" },
    { path: "public/sitemap.xml", type: "blob" },
    { path: "src/app/layout.tsx", type: "blob" },
    { path: "src/app/page.tsx", type: "blob" },
    { path: "src/app/head.tsx", type: "blob" },
    { path: "src/app/metadata.ts", type: "blob" },
    { path: "src/seo/index.ts", type: "blob" },
  ],
};

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

describe("web ↔ repository correlation", () => {
  let linkStore: InMemorySeoRepositoryLinkStore;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    const linkStoreModule = await import("../src/customer-zero/seo-repository.js");
    linkStore = new linkStoreModule.InMemorySeoRepositoryLinkStore();
    setSeoRepositoryLinkStore(linkStore);
    await linkStore.upsert({
      organizationId: ORG,
      departmentId: "seo",
      website: WEBSITE,
      provider: "github",
      repositoryId: "999",
      repositoryFullName: REPO_FULL,
      defaultBranch: "main",
      access: "read",
      selectedBy: USER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const tokenStore = new FakeOAuthTokenStore();
    await tokenStore.put({
      organizationId: ORG,
      userId: USER,
      provider: "github",
      accessToken: "ghp_corr",
      refreshToken: null,
      expiresAt: null,
      scopes: ["repo", "read:user"],
      accountLabel: "acme-bot",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
    });
    setExternalOAuthTokenStore(tokenStore);

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("correlates real audit findings with concrete repository files", async () => {
    // The audit issues present in this page (the page is healthy on
    // title/description/canonical, so the audit will not flag those).
    // We deliberately use a page that triggers real findings:
    //   - missing-sitemap (sitemap.xml absent or 404)
    //   - missing images-without-alt or missing-canonical if we omit them.
    // The production audit also flags "long-title" if title > 60 chars.
    // To keep the test deterministic we focus on what we know the audit
    // returns for the HTML above.
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // Sitemap is checked BEFORE the generic website handler — the audit
      // fetches https://acme.example/sitemap.xml and we want a real 404 so
      // the audit emits the missing-sitemap issue.
      if (url.includes("/sitemap.xml")) {
        return new Response("not found", { status: 404 });
      }
      // Main page + internal links.
      if (url.startsWith(WEBSITE)) {
        return new Response(PAGE_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.startsWith("https://api.github.com/")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer ghp_corr");
        return new Response(JSON.stringify(REPO_TREE_RESPONSE), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Anything else (robots.txt, etc.) — return 200.
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;

    // 1. Real auditWebsite() on a real (mocked) public page.
    const report = await auditWebsite(WEBSITE);
    // The audit normalises the URL (adds trailing slash).
    expect(report.url.replace(/\/$/, "")).toBe(WEBSITE);
    // Title is short (<= 60) → no long-title issue.
    expect(report.page.title.length).toBeLessThanOrEqual(60);

    // 2. Real inspectGithubRepository() against the linked repo.
    const link = (await linkStore.get(ORG, WEBSITE))!;
    const inspection = await inspectGithubRepository({
      organizationId: ORG,
      userId: USER,
      link,
      issueIds: report.issues.map((i) => i.id),
    });

    // 3. Real correlation builder.
    const correlation = buildSeoCorrelation(
      {
        url: report.url,
        page: {
          title: report.page.title,
          description: report.page.description,
          canonical: report.page.canonical,
          robots: report.page.robots,
          headings: report.page.headings,
          sitemap: report.page.sitemap,
          imagesWithoutAlt: report.page.imagesWithoutAlt,
          structuredDataBlocks: report.page.structuredDataBlocks,
        },
        issues: report.issues.map((i) => ({
          id: i.id,
          title: i.title,
          impact: i.impact,
          evidence: i.evidence,
        })),
      },
      inspection,
    );

    expect(correlation.website.replace(/\/$/, "")).toBe(WEBSITE);
    expect(correlation.repository?.fullName).toBe(REPO_FULL);

    // At minimum, missing-sitemap MUST be correlatable because the repo
    // has public/sitemap.xml + next.config.js and the audit found sitemap
    // is missing on the live page.
    expect(correlation.sections.length).toBeGreaterThan(0);
    expect(correlation.sections.find((s) => s.issueId === "missing-sitemap")).toBeDefined();
    expect(correlation.sections.map((s) => s.issueId).sort()).toEqual(
      expect.arrayContaining(["missing-sitemap", "images-without-alt"]),
    );

    // 4. Render the markdown correlation and enforce the honesty contract.
    const markdown = renderSeoCorrelationMarkdown(correlation);
    expect(markdown).toMatch(/### Web ↔ Repositorio — correlación/);
    // Every section has OBSERVED, INFERRED, RECOMMENDED.
    expect(markdown).toMatch(/OBSERVADO \(web\)/);
    expect(markdown).toMatch(/OBSERVADO \(repo\)/);
    expect(markdown).toMatch(/INFERENCIA/);
    expect(markdown).toMatch(/RECOMENDACIÓN/);
    // No inference is presented as observed.
    expect(markdown).not.toMatch(/INFERENCIA: \*\*/);
  });

  it("returns an empty sections array when no issue has matching repository files", () => {
    const fakeInspection: SeoRepositoryInspection = {
      repository: {
        id: "1",
        fullName: REPO_FULL,
        private: false,
        defaultBranch: "main",
        htmlUrl: `https://github.com/${REPO_FULL}`,
      },
      files: ["README.md"],
      likelyMetadataFiles: [],
      issueFileHints: {},
    };
    const correlation = buildSeoCorrelation(
      {
        url: WEBSITE,
        page: {
          title: "x",
          description: "x",
          canonical: null,
          robots: null,
          headings: { h1: [], h2: [], h3: [] },
          sitemap: "missing",
          imagesWithoutAlt: 0,
          structuredDataBlocks: 0,
        },
        issues: [
          { id: "missing-title", title: "t", impact: "i", evidence: "e" },
        ],
      },
      fakeInspection,
    );
    expect(correlation.sections).toEqual([]);
    const md = renderSeoCorrelationMarkdown(correlation);
    expect(md).toMatch(/No se ha podido correlacionar/);
  });
});