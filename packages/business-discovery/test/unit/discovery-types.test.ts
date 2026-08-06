import { describe, it, expect } from "vitest";
import {
  validateBusinessDiscoveryRequest,
  DiscoveryValidationError,
} from "../../src/contracts/discovery-types.js";

describe("Discovery Types", () => {
  describe("validateBusinessDiscoveryRequest", () => {
    it("should validate a correct request", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "normal" as const,
        options: {
          includeFounderBrain: true,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: true,
          depth: "standard" as const,
        },
      };

      const result = validateBusinessDiscoveryRequest(request);

      expect(result.organizationId).toBe("org-123");
      expect(result.priority).toBe("normal");
      expect(result.options.includeFounderBrain).toBe(true);
      expect(result.options.depth).toBe("standard");
    });

    it("should accept string date for requestedAt", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: "2024-01-01T00:00:00Z",
        priority: "normal" as const,
        options: {
          includeFounderBrain: false,
          includeCompetitorAnalysis: false,
          includeMarketAnalysis: false,
          depth: "basic" as const,
        },
      };

      const result = validateBusinessDiscoveryRequest(request);

      expect(result.requestedAt).toBeInstanceOf(Date);
    });

    it("should default depth to standard", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "high" as const,
        options: {
          includeFounderBrain: true,
        },
      };

      const result = validateBusinessDiscoveryRequest(request);

      expect(result.options.depth).toBe("standard");
    });

    it("should throw when request is not an object", () => {
      expect(() => validateBusinessDiscoveryRequest(null)).toThrow(
        DiscoveryValidationError,
      );
      expect(() => validateBusinessDiscoveryRequest("string")).toThrow(
        DiscoveryValidationError,
      );
    });

    it("should throw when organizationId is missing", () => {
      const request = {
        organizationId: null,
        requestedAt: new Date(),
        priority: "normal" as const,
        options: {},
      };

      expect(() => validateBusinessDiscoveryRequest(request)).toThrow(
        "organizationId",
      );
    });

    it("should throw when requestedAt is invalid", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: "invalid-date",
        priority: "normal" as const,
        options: {},
      };

      expect(() => validateBusinessDiscoveryRequest(request)).toThrow(
        "requestedAt",
      );
    });

    it("should throw when priority is invalid", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "invalid",
        options: {},
      };

      expect(() => validateBusinessDiscoveryRequest(request)).toThrow(
        "priority",
      );
    });

    it("should throw when options is missing", () => {
      const request = {
        organizationId: "org-123",
        requestedAt: new Date(),
        priority: "normal" as const,
        options: null,
      };

      expect(() => validateBusinessDiscoveryRequest(request)).toThrow(
        "options",
      );
    });
  });

  describe("BusinessDiscoveryRequest", () => {
    it("should accept all priority values", () => {
      const priorities: Array<"low" | "normal" | "high"> = ["low", "normal", "high"];

      for (const priority of priorities) {
        const request = {
          organizationId: "org-123",
          requestedAt: new Date(),
          priority,
          options: {},
        };

        const result = validateBusinessDiscoveryRequest(request);
        expect(result.priority).toBe(priority);
      }
    });

    it("should accept all depth values", () => {
      const depths: Array<"basic" | "standard" | "comprehensive"> = [
        "basic",
        "standard",
        "comprehensive",
      ];

      for (const depth of depths) {
        const request = {
          organizationId: "org-123",
          requestedAt: new Date(),
          priority: "normal" as const,
          options: { depth },
        };

        const result = validateBusinessDiscoveryRequest(request);
        expect(result.options.depth).toBe(depth);
      }
    });
  });
});
