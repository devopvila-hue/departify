import { describe, expect, it } from "vitest";
import {
  buildSeoResultContract,
  phaseForIssueId,
  groupIssuesIntoTask,
  renderSeoResultMarkdown,
} from "../src/customer-zero/seo-result-contract.js";

describe("SEO Result canonical contract", () => {
  it("phaseForIssueId places indexability blockers in 'now'", () => {
    expect(phaseForIssueId("noindex")).toBe("now");
    expect(phaseForIssueId("missing-sitemap")).toBe("now");
    expect(phaseForIssueId("broken-links")).toBe("now");
  });

  it("phaseForIssueId places metadata + heading issues in 'next'", () => {
    expect(phaseForIssueId("missing-title")).toBe("next");
    expect(phaseForIssueId("missing-description")).toBe("next");
    expect(phaseForIssueId("missing-canonical")).toBe("next");
    expect(phaseForIssueId("missing-h1")).toBe("next");
  });

  it("phaseForIssueId places alt text in 'later'", () => {
    expect(phaseForIssueId("images-without-alt")).toBe("later");
  });

  it("groupIssuesIntoTask labels indexability issues as 'Corregir indexación'", () => {
    const group = groupIssuesIntoTask(["missing-sitemap", "broken-links"]);
    expect(group.title).toMatch(/indexación/i);
  });

  it("groupIssuesIntoTask labels metadata issues as 'Corregir metadata'", () => {
    const group = groupIssuesIntoTask(["missing-title", "missing-description"]);
    expect(group.title).toMatch(/metadata/i);
  });

  it("buildSeoResultContract produces a versioned contract with the canonical shape", () => {
    const contract = buildSeoResultContract({
      audit: {
        url: "https://acme.example",
        fetchedAt: "2026-08-18T14:00:00.000Z",
        page: {
          title: "Acme",
          description: "Welcome",
          canonical: null,
          robots: null,
          headings: { h1: ["Hola"], h2: [], h3: [] },
          internalUrls: ["https://acme.example/about"],
          brokenUrls: ["https://acme.example/missing"],
          imagesWithoutAlt: 1,
          structuredDataBlocks: 0,
          socialMetadata: [],
          sitemap: "missing",
        },
        issues: [
          {
            id: "missing-sitemap",
            priority: "important",
            title: "Falta sitemap.xml",
            impact: "El descubrimiento de URLs es menos directo",
            evidence: "404 en /sitemap.xml",
          },
          {
            id: "images-without-alt",
            priority: "opportunity",
            title: "Imágenes sin alt",
            impact: "Accesibilidad",
            evidence: "1 imagen sin alt",
          },
        ],
      },
    });

    expect(contract.contract).toBe("seo.audit.result");
    expect(contract.version).toBe(1);
    expect(contract.url).toBe("https://acme.example");
    expect(contract.issues).toHaveLength(2);
    expect(contract.plan.totals.critical).toBe(0);
    expect(contract.plan.totals.important).toBe(1);
    expect(contract.plan.totals.opportunity).toBe(1);
    expect(contract.tasks.length).toBeGreaterThan(0);
    // Now bucket holds missing-sitemap
    const nowBucket = contract.plan.buckets.find((b) => b.phase === "now");
    expect(nowBucket?.issueIds).toContain("missing-sitemap");
    // Later bucket holds images-without-alt
    const laterBucket = contract.plan.buckets.find((b) => b.phase === "later");
    expect(laterBucket?.issueIds).toContain("images-without-alt");
  });

  it("buildSeoResultContract surfaces repository file hints per issue", () => {
    const contract = buildSeoResultContract({
      audit: {
        url: "https://acme.example",
        fetchedAt: "2026-08-18T14:00:00.000Z",
        page: {
          title: "Acme",
          description: "x",
          canonical: "x",
          robots: null,
          headings: { h1: ["x"], h2: [], h3: [] },
          internalUrls: [],
          brokenUrls: [],
          imagesWithoutAlt: 0,
          structuredDataBlocks: 0,
          socialMetadata: [],
          sitemap: "available",
        },
        issues: [
          {
            id: "missing-title",
            priority: "important",
            title: "Falta title",
            impact: "x",
            evidence: "no title",
          },
        ],
      },
      repository: {
        fullName: "acme/site",
        htmlUrl: "https://github.com/acme/site",
        defaultBranch: "main",
      },
      issueFileHints: {
        "missing-title": ["src/app/head.tsx", "src/app/layout.tsx"],
      },
    });

    const issue = contract.issues.find((i) => i.id === "missing-title")!;
    expect(issue.repositoryFiles).toEqual(["src/app/head.tsx", "src/app/layout.tsx"]);
    expect(issue.provenance.observedFromRepo).toBe(true);
    expect(contract.correlation.repository?.fullName).toBe("acme/site");
    expect(contract.correlation.sections).toHaveLength(1);
    expect(contract.correlation.sections[0]?.observedRepositoryFiles).toContain("src/app/head.tsx");
  });

  it("renderSeoResultMarkdown emits the chat-friendly summary with the OBSERVADO / RECOMENDACIÓN labels", () => {
    const contract = buildSeoResultContract({
      audit: {
        url: "https://acme.example",
        fetchedAt: "2026-08-18T14:00:00.000Z",
        page: {
          title: "Acme",
          description: "x",
          canonical: null,
          robots: null,
          headings: { h1: [], h2: [], h3: [] },
          internalUrls: [],
          brokenUrls: [],
          imagesWithoutAlt: 0,
          structuredDataBlocks: 0,
          socialMetadata: [],
          sitemap: "missing",
        },
        issues: [
          {
            id: "missing-sitemap",
            priority: "important",
            title: "Falta sitemap.xml",
            impact: "x",
            evidence: "404 en /sitemap.xml",
          },
        ],
      },
    });
    const md = renderSeoResultMarkdown(contract, true);
    expect(md).toMatch(/Auditor[ií]a SEO/);
    expect(md).toMatch(/Observado/);
    expect(md).toMatch(/Plan de resoluci[oó]n/);
    expect(md).toMatch(/OBSERVADO \(web\)/);
    expect(md).toMatch(/RECOMENDACI[OÓ]N/);
    // No infere presented as observation.
    expect(md).not.toMatch(/INFERENCIA: \*\*/);
  });
});