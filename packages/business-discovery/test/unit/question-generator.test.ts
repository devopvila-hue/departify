import { describe, it, expect } from "vitest";
import {
  generateQuestions,
  generateQuestionsForCategory,
  getQuestionTemplateByCategory,
  getAllQuestionCategories,
  calculateQuestionPriority,
} from "../../src/analysis/question-generator.js";
import { analyzeGaps } from "../../src/analysis/gap-analysis.js";
import { buildEmptyCompanyDNA } from "../../src/models/company-dna.js";
import {
  createDna,
  createBrain,
  verifiedDnaConfidence,
  verifiedBrainConfidence,
} from "../fixtures.js";

describe("Question Generator", () => {
  describe("generateQuestions", () => {
    it("should generate questions for all gaps", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const gapAnalysis = analyzeGaps(dna);

      const questions = generateQuestions(gapAnalysis);

      expect(questions.length).toBeGreaterThan(0);
      expect(questions.every((q) => q.gapId)).toBe(true);
    });

    it("should respect maxTotalQuestions limit", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const gapAnalysis = analyzeGaps(dna);

      const questions = generateQuestions(gapAnalysis, { maxTotalQuestions: 5 });

      expect(questions.length).toBeLessThanOrEqual(5);
    });

    it("should exclude low priority when not requested", () => {
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
          {
            id: "v2",
            name: "Value2",
            description: "Value2",
            confidence: verifiedDnaConfidence(),
          },
          {
            id: "v3",
            name: "Value3",
            description: "Value3",
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
          {
            id: "o2",
            title: "Expand",
            description: "Expand",
            timeframe: "2025",
            priority: "high",
            status: "planned",
            confidence: verifiedDnaConfidence(),
          },
          {
            id: "o3",
            title: "Innovate",
            description: "Innovate",
            timeframe: "2024",
            priority: "medium",
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

      const gapAnalysis = analyzeGaps(dna, brain);

      const questionsWithoutLow = generateQuestions(gapAnalysis, { includeLowPriority: false });
      const questionsWithLow = generateQuestions(gapAnalysis, { includeLowPriority: true });

      expect(questionsWithLow.length).toBeGreaterThanOrEqual(questionsWithoutLow.length);
    });

    it("should sort questions by priority", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const gapAnalysis = analyzeGaps(dna);

      const questions = generateQuestions(gapAnalysis);

      for (let i = 1; i < questions.length; i++) {
        const current = questions[i];
        const previous = questions[i - 1];
        expect(previous?.priority ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(
          current?.priority ?? 0,
        );
      }
    });

    it("should limit questions per gap", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const gapAnalysis = analyzeGaps(dna);

      const questions = generateQuestions(gapAnalysis, { maxQuestionsPerGap: 1 });

      // Count questions per gap ID
      const gapCounts = new Map<string, number>();
      for (const q of questions) {
        gapCounts.set(q.gapId, (gapCounts.get(q.gapId) ?? 0) + 1);
      }

      for (const [, count] of gapCounts) {
        expect(count).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("generateQuestionsForCategory", () => {
    it("should generate questions for a specific category", () => {
      const questions = generateQuestionsForCategory("mission");

      expect(questions.length).toBeGreaterThan(0);
      expect(questions.every((q) => q.category === "mission")).toBe(true);
    });

    it("should generate questions with correct type", () => {
      const toneQuestions = generateQuestionsForCategory("tone");
      expect(toneQuestions[0]?.type).toBe("multiple_choice");

      const missionQuestions = generateQuestionsForCategory("mission");
      expect(missionQuestions[0]?.type).toBe("open");
    });

    it("should include options for multiple choice questions", () => {
      const toneQuestions = generateQuestionsForCategory("tone");

      expect(toneQuestions[0]?.options).toBeDefined();
      expect(toneQuestions[0]?.options?.length).toBeGreaterThan(0);
    });
  });

  describe("getQuestionTemplateByCategory", () => {
    it("should return template for valid category", () => {
      const template = getQuestionTemplateByCategory("mission");

      expect(template).toBeDefined();
      expect(template?.category).toBe("mission");
      expect(template?.questions.length).toBeGreaterThan(0);
    });

    it("should return undefined for invalid category", () => {
      const template = getQuestionTemplateByCategory("invalid" as never);

      expect(template).toBeUndefined();
    });

    it("should include correct priority base", () => {
      const missionTemplate = getQuestionTemplateByCategory("mission");
      const toneTemplate = getQuestionTemplateByCategory("tone");

      expect(missionTemplate?.priorityBase).toBeGreaterThan(toneTemplate?.priorityBase ?? 0);
    });
  });

  describe("getAllQuestionCategories", () => {
    it("should return all available categories", () => {
      const categories = getAllQuestionCategories();

      expect(categories.length).toBeGreaterThan(0);
      expect(categories).toContain("mission");
      expect(categories).toContain("vision");
      expect(categories).toContain("values");
      expect(categories).toContain("products");
    });
  });

  describe("calculateQuestionPriority", () => {
    it("should boost priority for critical importance", () => {
      const basePriority = 100;
      const criticalPriority = calculateQuestionPriority(basePriority, "critical");
      const lowPriority = calculateQuestionPriority(basePriority, "low");

      expect(criticalPriority).toBeGreaterThan(lowPriority);
    });

    it("should apply correct boost amounts", () => {
      const basePriority = 50;

      expect(calculateQuestionPriority(basePriority, "critical")).toBe(basePriority + 50);
      expect(calculateQuestionPriority(basePriority, "high")).toBe(basePriority + 30);
      expect(calculateQuestionPriority(basePriority, "medium")).toBe(basePriority + 10);
      expect(calculateQuestionPriority(basePriority, "low")).toBe(basePriority);
    });
  });
});
