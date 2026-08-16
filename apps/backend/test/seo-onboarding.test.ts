import { describe, expect, it } from "vitest";
import { buildSeoOnboardingState } from "../src/customer-zero/seo-onboarding.js";

const repository = {
  organizationId: "org_a",
  departmentId: "seo" as const,
  website: "https://example.com",
  provider: "github" as const,
  repositoryId: "1",
  repositoryFullName: "company/site",
  defaultBranch: "main",
  access: "read" as const,
  selectedBy: "user_a",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

describe("SEO onboarding state", () => {
  it("asks for the web asset before asking for a repository", () => {
    expect(buildSeoOnboardingState({ website: null, repository: null, repositoryConnected: false }).stage).toBe("website_missing");
  });

  it("detects the web and keeps public SEO available without a repository", () => {
    const state = buildSeoOnboardingState({ website: repository.website, repository: null, repositoryConnected: false });
    expect(state).toMatchObject({ stage: "repository_missing", websiteDetected: true, repositoryRead: false, repositoryWrite: false });
  });

  it("moves from connected provider to durable project selection and ready READ", () => {
    expect(buildSeoOnboardingState({ website: repository.website, repository: null, repositoryConnected: true }).stage).toBe("repository_select");
    expect(buildSeoOnboardingState({ website: repository.website, repository, repositoryConnected: true })).toMatchObject({ stage: "ready", repositoryRead: true, repositoryWrite: false });
  });
});
