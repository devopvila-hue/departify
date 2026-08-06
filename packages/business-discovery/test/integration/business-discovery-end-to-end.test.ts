import { describe, it, expect } from "vitest";
import {
  BusinessDiscoveryService,
  validateBusinessDiscoveryRequest,
  generateSessionId,
  createDiscoverySession,
  getPipelinePhases,
  type BusinessDiscoveryRequest,
} from "../../src/index.js";
import { analyzeGaps } from "../../src/analysis/gap-analysis.js";
import { generateQuestions } from "../../src/analysis/question-generator.js";
import { buildEmptyCompanyDNA, calculateDnaCompleteness } from "../../src/models/company-dna.js";
import { buildEmptyFounderBrain, calculateBrainCompleteness } from "../../src/models/founder-brain.js";
import { calculateDiscoveryConfidence } from "../../src/models/discovery-report.js";
import {
  createDna,
  createBrain,
  verifiedDnaConfidence,
  verifiedBrainConfidence,
} from "../fixtures.js";

describe("Business Discovery End-to-End", () => {
  describe("Complete Pipeline Flow", () => {
    it("should execute full discovery pipeline", async () => {
      const service = new BusinessDiscoveryService({
        now: () => new Date("2024-01-15T10:00:00Z"),
        sessionIdGenerator: () => "e2e-session-123",
      });

      const request: BusinessDiscoveryRequest = {
        organizationId: "org-e2e-test",
        requestedAt: new Date("2024-01-15T10:00:00Z"),
        priority: "high",
        options: {
          includeFounderBrain: true,
          includeCompetitorAnalysis: true,
          includeMarketAnalysis: true,
          depth: "comprehensive",
        },
      };

      const result = await service.initiateDiscovery(request);

      // Verify result structure
      expect(result.status).toBe("completed");
      expect(result.organizationId).toBe("org-e2e-test");
      expect(result.sessionId).toBe("e2e-session-123");
      expect(result.report).toBeDefined();
      expect(result.errors).toHaveLength(0);

      // Verify report structure
      const report = result.report!;
      expect(report.organizationId).toBe("org-e2e-test");
      expect(report.sessionId).toBe("e2e-session-123");
      expect(report.companyDna).toBeDefined();
      expect(report.founderBrain).toBeDefined();
      expect(report.gaps).toBeDefined();
      expect(report.questions).toBeDefined();
      expect(report.findings).toBeDefined();
      expect(report.confidence).toBeDefined();
    });

    it("should work without Founder Brain", async () => {
      const service = new BusinessDiscoveryService({
        sessionIdGenerator: () => "no-brain-session",
      });

      const request: BusinessDiscoveryRequest = {
        organizationId: "org-no-brain",
        requestedAt: new Date(),
        priority: "normal",
        options: {
          includeFounderBrain: false,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: false,
          depth: "basic",
        },
      };

      const result = await service.initiateDiscovery(request);

      expect(result.status).toBe("completed");
      expect(result.report?.founderBrain).toBeUndefined();
    });
  });

  describe("Gap Analysis Integration", () => {
    it("should analyze gaps and generate questions", () => {
      const dna = buildEmptyCompanyDNA("org-gap-test");
      const brain = buildEmptyFounderBrain("org-gap-test");

      const gapAnalysis = analyzeGaps(dna, brain);
      const questions = generateQuestions(gapAnalysis);

      expect(gapAnalysis.gaps.length).toBeGreaterThan(0);
      expect(questions.length).toBeGreaterThan(0);

      // Verify questions reference valid gap IDs
      const gapIds = new Set(gapAnalysis.gaps.map((g) => g.id));
      for (const question of questions) {
        expect(gapIds.has(question.gapId)).toBe(true);
      }
    });

    it("should reduce questions when gaps are filled", () => {
      const emptyDna = buildEmptyCompanyDNA("org-empty");
      const emptyAnalysis = analyzeGaps(emptyDna);
      const emptyQuestions = generateQuestions(emptyAnalysis, { maxTotalQuestions: 100 });

      const filledDna = createDna({
        mission: {
          statement: "To make the world better",
          confidence: verifiedDnaConfidence(),
        },
        products: [
          {
            id: "p1",
            name: "Product A",
            description: "A great product",
            targetAudience: "Everyone",
            keyFeatures: ["Feature 1"],
            stage: "launched",
            confidence: verifiedDnaConfidence(),
          },
        ],
      });

      const filledAnalysis = analyzeGaps(filledDna);
      const filledQuestions = generateQuestions(filledAnalysis, { maxTotalQuestions: 100 });

      expect(filledAnalysis.gaps.length).toBeLessThan(emptyAnalysis.gaps.length);
      expect(filledQuestions.length).toBeLessThan(emptyQuestions.length);
    });
  });

  describe("Confidence Calculation Integration", () => {
    it("should calculate confidence from DNA and Brain", () => {
      const dna = buildEmptyCompanyDNA("org-confidence");
      const brain = buildEmptyFounderBrain("org-confidence");

      const confidence = calculateDiscoveryConfidence(dna, brain);

      expect(confidence.overall).toBe("low");
      expect(confidence.companyDna).toBe(0);
      expect(confidence.founderBrain).toBe(0);

      // Build DNA with data
      const dnaWithData = createDna({
        mission: {
          statement: "Mission",
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
      });

      const confidenceWithDna = calculateDiscoveryConfidence(dnaWithData, brain);
      expect(confidenceWithDna.companyDna).toBeGreaterThan(0);

      // Build Brain with data
      const brainWithData = createBrain({
        priorities: [
          {
            id: "p1",
            area: "Growth",
            description: "Grow",
            rank: 1,
            timeHorizon: "short_term",
            confidence: verifiedBrainConfidence(),
          },
        ],
      });

      const confidenceWithBoth = calculateDiscoveryConfidence(dnaWithData, brainWithData);
      expect(confidenceWithBoth.founderBrain).toBeGreaterThan(0);
    });
  });

  describe("Completeness Calculation", () => {
    it("should track completeness across DNA and Brain", () => {
      const dna = buildEmptyCompanyDNA("org-completeness");
      const brain = buildEmptyFounderBrain("org-completeness");

      expect(dna.completeness.overallPercentage).toBe(0);
      expect(brain.completeness.overallPercentage).toBe(0);

      // Build DNA with elements and recompute completeness
      const dnaWithElements = createDna({
        mission: {
          statement: "Mission",
          confidence: verifiedDnaConfidence(),
        },
        values: [
          {
            id: "v1",
            name: "Integrity",
            description: "Honesty",
            confidence: verifiedDnaConfidence(),
          },
        ],
      });

      const dnaCompleteness = calculateDnaCompleteness(dnaWithElements);
      expect(dnaCompleteness.mission).toBe(true);
      expect(dnaCompleteness.values).toBe(true);

      // Build Brain with elements and recompute completeness
      const brainWithElements = createBrain({
        leadership: {
          style: "transformational",
          description: "Inspiring",
          microManagement: "low",
          teamInvolvement: "high",
          confidence: verifiedBrainConfidence(),
        },
      });

      const brainCompleteness = calculateBrainCompleteness(brainWithElements);
      expect(brainCompleteness.leadership).toBe(true);
    });
  });

  describe("Request Validation", () => {
    it("should validate complete requests", () => {
      const validRequest = {
        organizationId: "org-validation",
        requestedAt: new Date(),
        priority: "high" as const,
        options: {
          includeFounderBrain: true,
          includeCompetitorAnalysis: true,
          includeMarketAnalysis: true,
          depth: "comprehensive" as const,
        },
      };

      const validated = validateBusinessDiscoveryRequest(validRequest);

      expect(validated.organizationId).toBe("org-validation");
      expect(validated.priority).toBe("high");
      expect(validated.options.depth).toBe("comprehensive");
    });
  });

  describe("Session Management", () => {
    it("should create and track sessions", () => {
      const request: BusinessDiscoveryRequest = {
        organizationId: "org-session",
        requestedAt: new Date(),
        priority: "normal",
        options: {
          includeFounderBrain: false,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: false,
          depth: "standard",
        },
      };

      const sessionId = generateSessionId();
      const session = createDiscoverySession(request, sessionId);

      expect(session.sessionId).toBe(sessionId);
      expect(session.organizationId).toBe("org-session");
      expect(session.status).toBe("pending");
      expect(session.currentPhase).toBe("initialization");
      expect(session.phasesCompleted).toEqual([]);
    });
  });

  describe("Pipeline Phases", () => {
    it("should return all pipeline phases", () => {
      const phases = getPipelinePhases();

      expect(phases).toEqual([
        "initialization",
        "data_collection",
        "company_dna_analysis",
        "founder_brain_analysis",
        "gap_analysis",
        "question_generation",
        "finalization",
      ]);
    });

    it("should have all required phases in order", () => {
      const phases = getPipelinePhases();

      expect(phases).toContain("initialization");
      expect(phases).toContain("data_collection");
      expect(phases).toContain("company_dna_analysis");
      expect(phases).toContain("founder_brain_analysis");
      expect(phases).toContain("gap_analysis");
      expect(phases).toContain("question_generation");
      expect(phases).toContain("finalization");

      // Verify order
      expect(phases.indexOf("initialization")).toBeLessThan(phases.indexOf("data_collection"));
      expect(phases.indexOf("gap_analysis")).toBeLessThan(phases.indexOf("question_generation"));
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid requests gracefully", async () => {
      const service = new BusinessDiscoveryService();

      const invalidRequest = {
        organizationId: null,
        requestedAt: "invalid-date",
        priority: "invalid",
        options: null,
      };

      const result = await service.initiateDiscovery(invalidRequest);

      expect(result.status).toBe("failed");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBeDefined();
      expect(result.errors[0]?.phase).toBeDefined();
      expect(result.errors[0]?.message).toBeDefined();
    });

    it("should provide structured error information", async () => {
      const service = new BusinessDiscoveryService();

      const result = await service.initiateDiscovery({ invalid: "data" });

      expect(result.errors).toBeInstanceOf(Array);
      expect(result.metadata.confidence).toBeNull();
      expect(result.metadata.phasesExecuted).toBe(0);
    });
  });

  describe("Metadata Tracking", () => {
    it("should track execution metadata", async () => {
      const service = new BusinessDiscoveryService({
        sessionIdGenerator: () => "metadata-session",
      });

      const request: BusinessDiscoveryRequest = {
        organizationId: "org-metadata",
        requestedAt: new Date("2024-01-15T10:00:00Z"),
        priority: "normal",
        options: {
          includeFounderBrain: false,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: false,
          depth: "standard",
        },
      };

      const result = await service.initiateDiscovery(request);

      expect(result.metadata.phasesExecuted).toBe(7);
      expect(result.metadata.totalPhases).toBe(7);
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
