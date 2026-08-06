import { describe, it, expect } from "vitest";
import {
  analyzeGaps,
  getGapsByImportance,
  getBlockingGaps,
  meetsMinimumRequirements,
  getCompletenessSummary,
} from "../../src/analysis/gap-analysis.js";
import { buildEmptyCompanyDNA } from "../../src/models/company-dna.js";
import { buildEmptyFounderBrain } from "../../src/models/founder-brain.js";
import {
  createDna,
  createBrain,
  minimalDnaConfidence,
  verifiedDnaConfidence,
  minimalBrainConfidence,
  verifiedBrainConfidence,
} from "../fixtures.js";

describe("Gap Analysis", () => {
  describe("analyzeGaps", () => {
    it("should detect all gaps in empty DNA", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const result = analyzeGaps(dna);

      expect(result.gaps.length).toBeGreaterThan(0);
      expect(result.knownCategories.length).toBe(0);
      expect(result.overallCompleteness).toBe(0);
    });

    it("should identify critical gaps", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const result = analyzeGaps(dna);

      expect(result.criticalGaps.length).toBeGreaterThan(0);
      expect(result.criticalGaps.every((gap) => gap.blockingAction)).toBe(true);
    });

    it("should reduce gaps with populated DNA", () => {
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

      const result = analyzeGaps(dna);

      expect(result.gaps.length).toBeLessThan(
        analyzeGaps(buildEmptyCompanyDNA("org-123")).gaps.length,
      );
      expect(result.knownCategories).toContain("mission");
      expect(result.knownCategories).toContain("products");
    });

    it("should include Founder Brain gaps when provided", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const brain = buildEmptyFounderBrain("org-123");

      const resultWithoutBrain = analyzeGaps(dna);
      const resultWithBrain = analyzeGaps(dna, brain);

      expect(resultWithBrain.gaps.length).toBeGreaterThan(
        resultWithoutBrain.gaps.length,
      );
    });

    it("should calculate confidence by category", () => {
      const dna = createDna({
        mission: {
          statement: "Mission",
          confidence: minimalDnaConfidence(),
        },
        values: [
          {
            id: "v1",
            name: "Value 1",
            description: "First value",
            confidence: minimalDnaConfidence(),
          },
          {
            id: "v2",
            name: "Value 2",
            description: "Second value",
            confidence: minimalDnaConfidence(),
          },
          {
            id: "v3",
            name: "Value 3",
            description: "Third value",
            confidence: minimalDnaConfidence(),
          },
        ],
      });

      const result = analyzeGaps(dna);

      expect(result.confidenceByCategory.mission).toBe("low");
      expect(result.confidenceByCategory.values).toBe("high");
    });

    it("should track missing categories", () => {
      const dna = createDna({
        mission: {
          statement: "Mission",
          confidence: minimalDnaConfidence(),
        },
      });

      const result = analyzeGaps(dna);

      expect(result.missingCategories.length).toBeGreaterThan(0);
      expect(result.missingCategories).not.toContain("mission");
    });
  });

  describe("getGapsByImportance", () => {
    it("should filter gaps by importance", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const analysis = analyzeGaps(dna);

      const criticalGaps = getGapsByImportance(analysis, "critical");
      const highGaps = getGapsByImportance(analysis, "high");

      expect(criticalGaps.every((gap) => gap.importance === "critical")).toBe(true);
      expect(highGaps.every((gap) => gap.importance === "high")).toBe(true);
    });

    it("should return empty array for non-existent importance", () => {
      const dna = createDna({
        mission: {
          statement: "Mission",
          confidence: minimalDnaConfidence(),
        },
        vision: {
          statement: "Vision",
          confidence: minimalDnaConfidence(),
        },
        values: [
          {
            id: "v1",
            name: "Value",
            description: "Value",
            confidence: minimalDnaConfidence(),
          },
        ],
        valueProposition: {
          statement: "Value prop",
          differentiation: ["Unique"],
          confidence: minimalDnaConfidence(),
        },
        products: [
          {
            id: "p1",
            name: "Product",
            description: "Product",
            targetAudience: "Everyone",
            keyFeatures: [],
            stage: "launched",
            confidence: minimalDnaConfidence(),
          },
        ],
        market: {
          industry: "Tech",
          competition: "high",
          confidence: minimalDnaConfidence(),
        },
        idealCustomer: {
          demographics: ["Adults"],
          psychographics: [],
          painPoints: [],
          buyingBehavior: [],
          confidence: minimalDnaConfidence(),
        },
        positioning: {
          statement: "Premium",
          differentiation: [],
          confidence: minimalDnaConfidence(),
        },
        objectives: [
          {
            id: "o1",
            title: "Grow",
            description: "Grow",
            timeframe: "2024",
            priority: "high",
            status: "in_progress",
            confidence: minimalDnaConfidence(),
          },
        ],
      });

      const analysis = analyzeGaps(dna);

      // With all critical gaps filled, there should be no critical gaps
      const criticalGaps = getGapsByImportance(analysis, "critical");
      expect(criticalGaps.length).toBe(0);
    });
  });

  describe("getBlockingGaps", () => {
    it("should return only blocking gaps", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const analysis = analyzeGaps(dna);

      const blockingGaps = getBlockingGaps(analysis);

      expect(blockingGaps.every((gap) => gap.blockingAction)).toBe(true);
      expect(blockingGaps.length).toBe(analysis.criticalGaps.length);
    });

    it("should return empty when all critical gaps are filled", () => {
      const dna = createDna({
        mission: {
          statement: "Mission",
          confidence: minimalDnaConfidence(),
        },
        vision: {
          statement: "Vision",
          confidence: minimalDnaConfidence(),
        },
        values: [
          {
            id: "v1",
            name: "Value",
            description: "Value",
            confidence: minimalDnaConfidence(),
          },
        ],
        valueProposition: {
          statement: "Value prop",
          differentiation: [],
          confidence: minimalDnaConfidence(),
        },
        products: [
          {
            id: "p1",
            name: "Product",
            description: "Product",
            targetAudience: "Everyone",
            keyFeatures: [],
            stage: "launched",
            confidence: minimalDnaConfidence(),
          },
        ],
        market: {
          industry: "Tech",
          competition: "high",
          confidence: minimalDnaConfidence(),
        },
        idealCustomer: {
          demographics: ["Adults"],
          psychographics: [],
          painPoints: [],
          buyingBehavior: [],
          confidence: minimalDnaConfidence(),
        },
        positioning: {
          statement: "Premium",
          differentiation: [],
          confidence: minimalDnaConfidence(),
        },
        objectives: [
          {
            id: "o1",
            title: "Grow",
            description: "Grow",
            timeframe: "2024",
            priority: "high",
            status: "in_progress",
            confidence: minimalDnaConfidence(),
          },
        ],
      });

      const brain = createBrain({
        priorities: [
          {
            id: "p1",
            area: "Growth",
            description: "Grow",
            rank: 1,
            timeHorizon: "short_term",
            confidence: minimalBrainConfidence(),
          },
          {
            id: "p2",
            area: "Product",
            description: "Build",
            rank: 2,
            timeHorizon: "medium_term",
            confidence: minimalBrainConfidence(),
          },
          {
            id: "p3",
            area: "Team",
            description: "Hire",
            rank: 3,
            timeHorizon: "immediate",
            confidence: minimalBrainConfidence(),
          },
        ],
        riskTolerance: {
          overall: "moderate",
          byCategory: {
            financial: "moderate",
            operational: "moderate",
            reputational: "moderate",
            innovation: "moderate",
          },
          confidence: minimalBrainConfidence(),
        },
        decisionMaking: {
          speed: "measured",
          style: "analytical",
          informationRequirement: "standard",
          decisionCriteria: ["ROI"],
          postDecisionReview: true,
          confidence: minimalBrainConfidence(),
        },
        communication: {
          preferredChannel: "slack",
          frequency: "daily",
          format: "semi_formal",
          detailLevel: "key_points",
          meetingPreference: "scheduled",
          feedbackStyle: "direct",
          availability: "9-5",
          responseTimeExpectation: "Same day",
          confidence: minimalBrainConfidence(),
        },
      });

      const analysis = analyzeGaps(dna, brain);
      const blockingGaps = getBlockingGaps(analysis);

      expect(blockingGaps.length).toBe(0);
    });
  });

  describe("meetsMinimumRequirements", () => {
    it("should return false for empty DNA", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const analysis = analyzeGaps(dna);

      expect(meetsMinimumRequirements(analysis)).toBe(false);
    });

    it("should return true when critical gaps are filled", () => {
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
            name: "Value",
            description: "Value",
            confidence: verifiedDnaConfidence(),
          },
        ],
        valueProposition: {
          statement: "Value prop",
          differentiation: [],
          confidence: verifiedDnaConfidence(),
        },
        products: [
          {
            id: "p1",
            name: "Product",
            description: "Product",
            targetAudience: "Everyone",
            keyFeatures: [],
            stage: "launched",
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
        positioning: {
          statement: "Premium",
          differentiation: [],
          confidence: verifiedDnaConfidence(),
        },
        objectives: [
          {
            id: "o1",
            title: "Grow",
            description: "Grow",
            timeframe: "2024",
            priority: "high",
            status: "in_progress",
            confidence: verifiedDnaConfidence(),
          },
        ],
      });

      const brain = createBrain({
        priorities: [
          {
            id: "p1",
            area: "Growth",
            description: "Grow",
            rank: 1,
            timeHorizon: "short_term",
            confidence: verifiedBrainConfidence(),
          },
          {
            id: "p2",
            area: "Product",
            description: "Build",
            rank: 2,
            timeHorizon: "medium_term",
            confidence: verifiedBrainConfidence(),
          },
          {
            id: "p3",
            area: "Team",
            description: "Hire",
            rank: 3,
            timeHorizon: "immediate",
            confidence: verifiedBrainConfidence(),
          },
        ],
        riskTolerance: {
          overall: "moderate",
          byCategory: {
            financial: "moderate",
            operational: "moderate",
            reputational: "moderate",
            innovation: "moderate",
          },
          confidence: verifiedBrainConfidence(),
        },
        decisionMaking: {
          speed: "measured",
          style: "analytical",
          informationRequirement: "standard",
          decisionCriteria: ["ROI"],
          postDecisionReview: true,
          confidence: verifiedBrainConfidence(),
        },
        communication: {
          preferredChannel: "slack",
          frequency: "daily",
          format: "semi_formal",
          detailLevel: "key_points",
          meetingPreference: "scheduled",
          feedbackStyle: "direct",
          availability: "9-5",
          responseTimeExpectation: "Same day",
          confidence: verifiedBrainConfidence(),
        },
      });

      const analysis = analyzeGaps(dna, brain);

      expect(meetsMinimumRequirements(analysis)).toBe(true);
    });
  });

  describe("getCompletenessSummary", () => {
    it("should provide completeness breakdown", () => {
      const dna = createDna({
        mission: {
          statement: "Mission",
          confidence: minimalDnaConfidence(),
        },
      });

      const brain = createBrain({
        leadership: {
          style: "transformational",
          description: "Leader",
          microManagement: "low",
          teamInvolvement: "high",
          confidence: minimalBrainConfidence(),
        },
      });

      const analysis = analyzeGaps(dna, brain);
      const summary = getCompletenessSummary(analysis);

      expect(summary.companyDna).toBeGreaterThan(0);
      expect(summary.companyDna).toBeLessThan(100);
      expect(summary.founderBrain).toBeGreaterThan(0);
      expect(summary.founderBrain).toBeLessThan(100);
      expect(summary.overall).toBe(analysis.overallCompleteness);
    });
  });
});
