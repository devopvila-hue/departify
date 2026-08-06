import { describe, it, expect } from "vitest";
import {
  buildEmptyCompanyDNA,
  calculateDnaCompleteness,
  createMinimalConfidence,
  createVerifiedConfidence,
  mergeRawDna,
  validateCompanyDNA,
  CompanyDnaValidationError,
} from "../../src/models/company-dna.js";
import {
  createDna,
  minimalDnaConfidence,
  verifiedDnaConfidence,
} from "../fixtures.js";

describe("Company DNA", () => {
  describe("buildEmptyCompanyDNA", () => {
    it("should create an empty Company DNA", () => {
      const dna = buildEmptyCompanyDNA("org-123");

      expect(dna.organizationId).toBe("org-123");
      expect(dna.values).toEqual([]);
      expect(dna.products).toEqual([]);
      expect(dna.services).toEqual([]);
      expect(dna.strengths).toEqual([]);
      expect(dna.weaknesses).toEqual([]);
      expect(dna.objectives).toEqual([]);
      expect(dna.processes).toEqual([]);
      expect(dna.completeness.overallPercentage).toBe(0);
    });
  });

  describe("calculateDnaCompleteness", () => {
    it("should calculate 0% for empty DNA", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const completeness = calculateDnaCompleteness(dna);

      expect(completeness.overallPercentage).toBe(0);
      expect(completeness.mission).toBe(false);
      expect(completeness.products).toBe(false);
    });

    it("should calculate completeness correctly", () => {
      const dna = createDna({
        mission: {
          statement: "To make the world better",
          confidence: minimalDnaConfidence(),
        },
        products: [
          {
            id: "p1",
            name: "Product A",
            description: "A great product",
            targetAudience: "Everyone",
            keyFeatures: ["Feature 1"],
            stage: "launched",
            confidence: minimalDnaConfidence(),
          },
        ],
      });
      const completeness = calculateDnaCompleteness(dna);

      expect(completeness.mission).toBe(true);
      expect(completeness.products).toBe(true);
      expect(completeness.overallPercentage).toBeGreaterThan(0);
    });

    it("should handle fully populated DNA", () => {
      const dna = createDna({
        mission: {
          statement: "Mission",
          confidence: verifiedDnaConfidence(),
        },
        vision: {
          statement: "Vision",
          confidence: verifiedDnaConfidence(),
        },
        values: [
          {
            id: "v1",
            name: "Integrity",
            description: "Always honest",
            confidence: verifiedDnaConfidence(),
          },
        ],
        valueProposition: {
          statement: "Value prop",
          differentiation: ["Unique"],
          confidence: verifiedDnaConfidence(),
        },
        products: [
          {
            id: "p1",
            name: "Product",
            description: "Desc",
            targetAudience: "Everyone",
            keyFeatures: [],
            stage: "launched",
            confidence: verifiedDnaConfidence(),
          },
        ],
        services: [
          {
            id: "s1",
            name: "Service",
            description: "Desc",
            deliveryMethod: "Online",
            confidence: verifiedDnaConfidence(),
          },
        ],
        market: {
          industry: "Tech",
          competition: "high",
          confidence: verifiedDnaConfidence(),
        },
        idealCustomer: {
          demographics: ["Adults"],
          psychographics: [],
          painPoints: [],
          buyingBehavior: [],
          confidence: verifiedDnaConfidence(),
        },
        tone: {
          personality: ["Friendly"],
          voice: "Warm",
          styleExamples: [],
          confidence: verifiedDnaConfidence(),
        },
        positioning: {
          statement: "Premium",
          differentiation: [],
          confidence: verifiedDnaConfidence(),
        },
        strengths: [
          {
            id: "s1",
            category: "Team",
            description: "Great team",
            evidence: [],
            confidence: verifiedDnaConfidence(),
          },
        ],
        weaknesses: [
          {
            id: "w1",
            category: "Budget",
            description: "Limited budget",
            confidence: verifiedDnaConfidence(),
          },
        ],
        objectives: [
          {
            id: "o1",
            title: "Grow",
            description: "Grow revenue",
            timeframe: "2024",
            priority: "high",
            status: "in_progress",
            confidence: verifiedDnaConfidence(),
          },
        ],
        processes: [
          {
            id: "pr1",
            name: "Sales",
            description: "Sales process",
            maturity: "defined",
            confidence: verifiedDnaConfidence(),
          },
        ],
      });

      const completeness = calculateDnaCompleteness(dna);

      expect(completeness.overallPercentage).toBe(100);
    });
  });

  describe("createMinimalConfidence", () => {
    it("should create minimal confidence", () => {
      const confidence = createMinimalConfidence("user_input");

      expect(confidence.level).toBe("low");
      expect(confidence.source).toBe("user_input");
      expect(confidence.lastVerified).toBeInstanceOf(Date);
    });
  });

  describe("createVerifiedConfidence", () => {
    it("should create verified confidence", () => {
      const confidence = createVerifiedConfidence("website");

      expect(confidence.level).toBe("verified");
      expect(confidence.source).toBe("website");
      expect(confidence.lastVerified).toBeInstanceOf(Date);
    });
  });

  describe("validateCompanyDNA", () => {
    it("should validate correct Company DNA", () => {
      const dna = buildEmptyCompanyDNA("org-123");

      const result = validateCompanyDNA(dna);

      expect(result.organizationId).toBe("org-123");
    });

    it("should throw when DNA is not an object", () => {
      expect(() => validateCompanyDNA(null)).toThrow(CompanyDnaValidationError);
      expect(() => validateCompanyDNA("string")).toThrow(
        CompanyDnaValidationError,
      );
    });

    it("should throw when organizationId is missing", () => {
      const dna = createDna({ organizationId: null as unknown as string });

      expect(() => validateCompanyDNA(dna)).toThrow("organizationId");
    });

    it("should throw when lastUpdated is invalid", () => {
      const dna = createDna({ lastUpdated: "invalid" as unknown as Date });

      expect(() => validateCompanyDNA(dna)).toThrow("lastUpdated");
    });

    it("should throw when completeness is missing", () => {
      const dna = createDna({ completeness: null as unknown as never });

      expect(() => validateCompanyDNA(dna)).toThrow("completeness");
    });
  });

  describe("mergeRawDna", () => {
    it("merges host-provided company information onto the empty DNA", () => {
      const base = buildEmptyCompanyDNA("org-moon");
      const merged = mergeRawDna(base, {
        mission: {
          statement: "MOON shared living",
          confidence: {
            level: "verified",
            source: "user_input",
            lastVerified: new Date(),
          },
        },
      });

      expect(merged.organizationId).toBe("org-moon");
      expect(merged.mission?.statement).toBe("MOON shared living");
      // Completeness is recalculated: mission is now populated.
      expect(merged.completeness.mission).toBe(true);
      expect(merged.completeness.overallPercentage).toBeGreaterThan(0);
    });

    it("leaves absent fields empty", () => {
      const base = buildEmptyCompanyDNA("org-moon");
      const merged = mergeRawDna(base, {
        mission: {
          statement: "MOON shared living",
          confidence: {
            level: "verified",
            source: "user_input",
            lastVerified: new Date(),
          },
        },
      });

      expect(merged.vision).toBeUndefined();
      expect(merged.products).toHaveLength(0);
      expect(merged.completeness.vision).toBe(false);
    });
  });
});
