import { describe, it, expect } from "vitest";
import {
  buildEmptyFounderBrain,
  calculateBrainCompleteness,
  createMinimalBrainConfidence,
  createVerifiedBrainConfidence,
  validateFounderBrain,
  FounderBrainValidationError,
  type LeadershipStyle,
} from "../../src/models/founder-brain.js";
import {
  createBrain,
  minimalBrainConfidence,
  verifiedBrainConfidence,
} from "../fixtures.js";

describe("Founder Brain", () => {
  describe("buildEmptyFounderBrain", () => {
    it("should create an empty Founder Brain", () => {
      const brain = buildEmptyFounderBrain("org-123");

      expect(brain.organizationId).toBe("org-123");
      expect(brain.priorities).toEqual([]);
      expect(brain.completeness.overallPercentage).toBe(0);
    });
  });

  describe("calculateBrainCompleteness", () => {
    it("should calculate 0% for empty brain", () => {
      const brain = buildEmptyFounderBrain("org-123");
      const completeness = calculateBrainCompleteness(brain);

      expect(completeness.overallPercentage).toBe(0);
      expect(completeness.leadership).toBe(false);
      expect(completeness.priorities).toBe(false);
    });

    it("should calculate completeness correctly", () => {
      const brain = createBrain({
        leadership: {
          style: "transformational",
          description: "Inspiring leader",
          microManagement: "low",
          teamInvolvement: "high",
          confidence: minimalBrainConfidence(),
        },
        priorities: [
          {
            id: "p1",
            area: "Growth",
            description: "Grow revenue",
            rank: 1,
            timeHorizon: "short_term",
            confidence: minimalBrainConfidence(),
          },
        ],
      });

      const completeness = calculateBrainCompleteness(brain);

      expect(completeness.leadership).toBe(true);
      expect(completeness.priorities).toBe(true);
      expect(completeness.overallPercentage).toBeGreaterThan(0);
    });

    it("should handle fully populated brain", () => {
      const brain = createBrain({
        leadership: {
          style: "visionary",
          description: "Visionary leader",
          microManagement: "low",
          teamInvolvement: "high",
          confidence: verifiedBrainConfidence(),
        },
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
        philosophy: {
          coreBeliefs: ["People first"],
          principles: ["Transparency"],
          nonNegotiables: ["Integrity"],
          attitudeTowardsGrowth: "aggressive",
          attitudeTowardsRisk: "Risk is opportunity",
          confidence: verifiedBrainConfidence(),
        },
        riskTolerance: {
          overall: "high",
          byCategory: {
            financial: "moderate",
            operational: "high",
            reputational: "low",
            innovation: "aggressive",
          },
          rationale: "Growth requires risk",
          confidence: verifiedBrainConfidence(),
        },
        delegation: {
          preference: "empower",
          whatDelegates: ["Operations"],
          whatRetains: ["Strategy"],
          trustBuilding: "Incremental",
          feedbackFrequency: "weekly",
          confidence: verifiedBrainConfidence(),
        },
        decisionMaking: {
          speed: "fast",
          style: "analytical",
          informationRequirement: "standard",
          decisionCriteria: ["ROI", "Impact"],
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
          availability: "9-5 ET",
          responseTimeExpectation: "Same day",
          confidence: verifiedBrainConfidence(),
        },
        preferences: {
          workingHours: "9-5",
          deepWorkWindows: ["9-11"],
          preferredMeetingTimes: ["10-11", "2-3"],
          reportingCadence: "weekly",
          dashboards: ["Revenue", "Active Users"],
          alerts: ["Server down", "Revenue drop"],
          confidence: verifiedBrainConfidence(),
        },
      });

      const completeness = calculateBrainCompleteness(brain);

      expect(completeness.overallPercentage).toBe(100);
    });
  });

  describe("createMinimalBrainConfidence", () => {
    it("should create minimal confidence", () => {
      const confidence = createMinimalBrainConfidence("user_input");

      expect(confidence.level).toBe("low");
      expect(confidence.source).toBe("user_input");
      expect(confidence.lastVerified).toBeInstanceOf(Date);
    });
  });

  describe("createVerifiedBrainConfidence", () => {
    it("should create verified confidence", () => {
      const confidence = createVerifiedBrainConfidence("social_media");

      expect(confidence.level).toBe("verified");
      expect(confidence.source).toBe("social_media");
      expect(confidence.lastVerified).toBeInstanceOf(Date);
    });
  });

  describe("validateFounderBrain", () => {
    it("should validate correct Founder Brain", () => {
      const brain = buildEmptyFounderBrain("org-123");

      const result = validateFounderBrain(brain);

      expect(result.organizationId).toBe("org-123");
    });

    it("should throw when brain is not an object", () => {
      expect(() => validateFounderBrain(null)).toThrow(
        FounderBrainValidationError,
      );
      expect(() => validateFounderBrain("string")).toThrow(
        FounderBrainValidationError,
      );
    });

    it("should throw when organizationId is missing", () => {
      const brain = createBrain({ organizationId: null as unknown as string });

      expect(() => validateFounderBrain(brain)).toThrow("organizationId");
    });

    it("should throw when lastUpdated is invalid", () => {
      const brain = createBrain({ lastUpdated: "invalid" as unknown as Date });

      expect(() => validateFounderBrain(brain)).toThrow("lastUpdated");
    });

    it("should throw when completeness is missing", () => {
      const brain = createBrain({ completeness: null as unknown as never });

      expect(() => validateFounderBrain(brain)).toThrow("completeness");
    });
  });

  describe("LeadershipStyle", () => {
    it("should accept all valid leadership styles", () => {
      const styles: LeadershipStyle[] = [
        "visionary",
        "transformational",
        "transactional",
        "servant",
        "democratic",
        "autocratic",
        "laissez_faire",
        "situational",
      ];

      for (const style of styles) {
        const brain = createBrain({
          leadership: {
            style,
            description: "Leader",
            microManagement: "low",
            teamInvolvement: "high",
            confidence: minimalBrainConfidence(),
          },
        });

        expect(validateFounderBrain(brain).leadership?.style).toBe(style);
      }
    });
  });
});
