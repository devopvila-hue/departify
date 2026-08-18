/**
 * Diagnostic: run auditWebsite against a real public URL and print the
 * raw issues. Used to verify whether production reports 0 issues because
 * the web is healthy OR because issues disappear during persistence.
 */
import { auditWebsite } from "../src/customer-zero/seo-audit.js";

const url = process.argv[2] ?? "https://departify.app/";

(async () => {
  const report = await auditWebsite(url);
  console.log(JSON.stringify({
    url: report.url,
    fetchedAt: report.fetchedAt,
    page: {
      title: report.page.title,
      titleLength: report.page.title.length,
      description: report.page.description,
      canonical: report.page.canonical,
      robots: report.page.robots,
      h1: report.page.headings.h1,
      h1Count: report.page.headings.h1.length,
      h2Count: report.page.headings.h2.length,
      h3Count: report.page.headings.h3.length,
      internalLinksChecked: report.page.internalUrls.length,
      brokenInternalLinks: report.page.brokenUrls.length,
      imagesWithoutAlt: report.page.imagesWithoutAlt,
      structuredDataBlocks: report.page.structuredDataBlocks,
      socialMetadata: report.page.socialMetadata,
      sitemap: report.page.sitemap,
    },
    issues: report.issues.map((i) => ({
      id: i.id,
      priority: i.priority,
      title: i.title,
      impact: i.impact,
      evidence: i.evidence,
    })),
    counts: {
      total: report.issues.length,
      critical: report.issues.filter((i) => i.priority === "critical").length,
      important: report.issues.filter((i) => i.priority === "important").length,
      opportunity: report.issues.filter((i) => i.priority === "opportunity").length,
    },
  }, null, 2));
})().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});