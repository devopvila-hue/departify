import { describe, it, expect, beforeEach } from "vitest";
import { BusinessDiscoveryService, createBusinessDiscoveryService } from "../../src/service/discovery-service.js";
import { generateSessionId } from "../../src/pipeline/discovery-pipeline.js";
import { buildEmptyCompanyDNA } from "../../src/models/company-dna.js";
import { buildEmptyFounderBrain } from "../../src/models/founder-brain.js";
import { calculateDiscoveryConfidence } from "../../src/models/discovery-report.js";

describe("Business Discovery Service", () => {
  let service: BusinessDiscoveryService;

  beforeEach(() => {
    service = createBusinessDiscoveryService({
      now: () => new Date("2024-01-01T00:00:00Z"),
      sessionIdGenerator: () => "test-session-123",
    });
  });

  describe("initiateDiscovery", () => {
    it("should initiate discovery successfully", async () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date("2024-01-01T00:00:00Z"),
        priority: "normal" as const,
        options: {
          includeFounderBrain: true,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: true,
          depth: "standard" as const,
        },
      };

      const result = await service.initiateDiscovery(request);

      expect(result.organizationId).toBe("org-123");
      expect(result.sessionId).toBe("test-session-123");
      expect(result.status).toBe("completed");
      expect(result.report).toBeDefined();
    });

    it("should handle invalid request", async () => {
      const request = {
        organizationId: null,
      };

      const result = await service.initiateDiscovery(request);

      expect(result.status).toBe("failed");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should clean up session after completion", async () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "normal" as const,
        options: {},
      };

      expect(service.getActiveSessionCount()).toBe(0);
      await service.initiateDiscovery(request);
      expect(service.getActiveSessionCount()).toBe(0);
    });

    it("should respect includeFounderBrain option", async () => {
      const requestWithBrain = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "normal" as const,
        options: {
          includeFounderBrain: true,
        },
      };

      const requestWithoutBrain = {
        organizationId: "org-456",
        requestedAt: new Date(),
        priority: "normal" as const,
        options: {
          includeFounderBrain: false,
        },
      };

      const resultWithBrain = await service.initiateDiscovery(requestWithBrain);
      const resultWithoutBrain = await service.initiateDiscovery(requestWithoutBrain);

      expect(resultWithBrain.report?.founderBrain).toBeDefined();
      expect(resultWithoutBrain.report?.founderBrain).toBeUndefined();
    });
  });

  describe("getActiveSessionCount", () => {
    it("should return zero when no sessions", () => {
      expect(service.getActiveSessionCount()).toBe(0);
    });
  });

  describe("isSessionActive", () => {
    it("should return false for non-existent session", () => {
      expect(service.isSessionActive("non-existent")).toBe(false);
    });
  });

  describe("getOrganizationForSession", () => {
    it("should return undefined for non-existent session", () => {
      expect(service.getOrganizationForSession("non-existent")).toBeUndefined();
    });
  });

  describe("validateRequest", () => {
    it("should validate correct request", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "normal" as const,        options: {},
      };

      const result = service.validateRequest(request);

      expect(result.organizationId).toBe("org-123");
    });

    it("should throw for invalid request", () => {
      expect(() => service.validateRequest(null)).toThrow();
    });
  });

  describe("validateCompanyDna", () => {
    it("should validate correct Company DNA", () => {
      const dna = buildEmptyCompanyDNA("org-123");

      const result = service.validateCompanyDna(dna);

      expect(result.organizationId).toBe("org-123");
    });
  });

  describe("validateFounderBrain", () => {
    it("should validate correct Founder Brain", () => {
      const brain = buildEmptyFounderBrain("org-123");

      const result = service.validateFounderBrain(brain);

      expect(result.organizationId).toBe("org-123");
    });
  });

  describe("validateDiscoveryReport", () => {
    it("should validate correct Discovery Report", () => {
      const dna = buildEmptyCompanyDNA("org-123");
      const report = {
        organizationId: "org-123",
        sessionId: "session-123",
        metadata: {
          sessionId: "session-123",
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 1000,
          sources: [],
          dataPoints: 0,
          questionsAsked: 0,
          questionsAnswered: 0,
        },
        companyDna: dna,
        findings: [],
        gaps: [],
        questions: [],
        confidence: calculateDiscoveryConfidence(dna),
        generatedAt: new Date(),
      };

      const result = service.validateDiscoveryReport(report);

      expect(result.organizationId).toBe("org-123");
    });
  });

  describe("initiateDiscovery with rawData", () => {
    it("builds a real Company DNA from the host-provided company information", async () => {
      const service = new BusinessDiscoveryService({
        sessionIdGenerator: () => "session-rawdata",
      });

      const request = {
        organizationId: "org-moon",
        requestedAt: new Date("2026-08-06T10:00:00Z"),
        priority: "high" as const,
        options: {
          includeFounderBrain: true,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: false,
          depth: "standard" as const,
        },
        rawData: {
          mission: {
            statement: "MOON co-living: shared living in Barcelona and Madrid",
            confidence: {
              level: "verified" as const,
              source: "user_input" as const,
              lastVerified: new Date("2026-08-06T10:00:00Z"),
            },
          },
          market: {
            industry: "co-living",
            competition: "medium" as const,
            confidence: {
              level: "high" as const,
              source: "user_input" as const,
              lastVerified: new Date("2026-08-06T10:00:00Z"),
            },
          },
        },
      };

      const result = await service.initiateDiscovery(request);

      expect(result.status).toBe("completed");
      expect(result.report).toBeDefined();
      const report = result.report!;
      expect(report.companyDna.mission?.statement).toContain("MOON");
      expect(report.companyDna.market?.industry).toBe("co-living");
      // The mission gap is closed because the CEO provided it.
      expect(report.gaps.some((gap) => gap.category === "mission")).toBe(
        false,
      );
    });
  });
});

describe("generateSessionId", () => {
  it("should generate unique session IDs", () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^discovery_\d+_[a-z0-9]+$/);
    expect(id2).toMatch(/^discovery_\d+_[a-z0-9]+$/);
  });
});
