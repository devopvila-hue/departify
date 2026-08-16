import type { SeoRepositoryLink } from "./seo-repository.js";

export type SeoOnboardingStage =
  | "website_missing"
  | "repository_missing"
  | "repository_select"
  | "ready";

export interface SeoOnboardingState {
  readonly stage: SeoOnboardingStage;
  readonly websiteDetected: boolean;
  readonly repositoryConnected: boolean;
  readonly repositoryRead: boolean;
  readonly repositoryWrite: false;
}

export function buildSeoOnboardingState(input: {
  readonly website: string | null | undefined;
  readonly repository: SeoRepositoryLink | null;
  readonly repositoryConnected: boolean;
}): SeoOnboardingState {
  const websiteDetected = Boolean(input.website);
  const repositoryRead = Boolean(input.repository && input.repositoryConnected);
  return {
    stage: !websiteDetected
      ? "website_missing"
      : repositoryRead
        ? "ready"
        : input.repositoryConnected
          ? "repository_select"
          : "repository_missing",
    websiteDetected,
    repositoryConnected: input.repositoryConnected,
    repositoryRead,
    repositoryWrite: false,
  };
}
