/**
 * Shared test fixtures for Business Discovery.
 *
 * The domain contract is immutable (`readonly`), so tests must never mutate
 * model instances. These helpers build fully-typed objects via spread over
 * the canonical empty builders, mirroring the pattern used in
 * `company-dna.test.ts`.
 */

import {
  buildEmptyCompanyDNA,
  createMinimalConfidence,
  createVerifiedConfidence,
  type CompanyDNA,
} from "../src/models/company-dna.js";
import {
  buildEmptyFounderBrain,
  createMinimalBrainConfidence,
  createVerifiedBrainConfidence,
  type FounderBrain,
} from "../src/models/founder-brain.js";

export function createDna(
  overrides: Partial<CompanyDNA> = {},
): CompanyDNA {
  return { ...buildEmptyCompanyDNA("org-123"), ...overrides };
}

export function createBrain(
  overrides: Partial<FounderBrain> = {},
): FounderBrain {
  return { ...buildEmptyFounderBrain("org-123"), ...overrides };
}

export function minimalDnaConfidence() {
  return createMinimalConfidence("user_input");
}

export function verifiedDnaConfidence() {
  return createVerifiedConfidence("user_input");
}

export function minimalBrainConfidence() {
  return createMinimalBrainConfidence("user_input");
}

export function verifiedBrainConfidence() {
  return createVerifiedBrainConfidence("user_input");
}
