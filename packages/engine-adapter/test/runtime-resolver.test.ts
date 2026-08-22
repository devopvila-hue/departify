/**
 * Runtime Resolver Tests — Sprint ENGINE 02 Phase 2.
 *
 * Tests the OrganizationRuntimeResolver for multi-engine routing.
 */

import { describe, it, expect } from "vitest";
import { OrganizationRuntimeResolver } from "../src/runtime-resolver.js";
import type { EngineAdapterConfig, MultiEngineConfig } from "@departify/config";

const DEFAULT_CONFIG: EngineAdapterConfig = {
  provider: "openclaw",
  gatewayUrl: "ws://engine-a:18889",
  gatewayToken: "token-a",
  requestTimeoutMs: 120_000,
  connectTimeoutMs: 15_000,
  retryLimit: 2,
  maxRetryDelayMs: 8_000,
  runtimePolicy: "strict",
};

const NEMOCLAW_CONFIG: MultiEngineConfig["nemoclawPoc"] = {
  gatewayUrl: "ws://engine-b:18789",
  gatewayToken: "token-b",
  orgIds: ["org-customer-zero", "org-test"],
};

describe("OrganizationRuntimeResolver", () => {
  describe("mode: current", () => {
    it("returns default config for all orgs", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "current" },
        DEFAULT_CONFIG,
      );

      expect(resolver.resolve("org-1")).toBe(DEFAULT_CONFIG);
      expect(resolver.resolve("org-2")).toBe(DEFAULT_CONFIG);
      expect(resolver.resolve("org-customer-zero")).toBe(DEFAULT_CONFIG);
    });

    it("reports no orgs as nemoclaw-poc", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "current" },
        DEFAULT_CONFIG,
      );

      expect(resolver.isNemoclawPoc("org-1")).toBe(false);
      expect(resolver.isNemoclawPoc("org-customer-zero")).toBe(false);
    });

    it("returns empty nemoclaw org list", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "current" },
        DEFAULT_CONFIG,
      );

      expect(resolver.getNemoclawPocOrgIds()).toEqual([]);
    });
  });

  describe("mode: nemoclaw-poc", () => {
    it("returns nemoclaw config for all orgs", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "nemoclaw-poc", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      const config = resolver.resolve("org-1");
      expect(config.gatewayUrl).toBe("ws://engine-b:18789");
      expect(config.gatewayToken).toBe("token-b");
      // Other settings inherited from default
      expect(config.requestTimeoutMs).toBe(120_000);
      expect(config.provider).toBe("openclaw");
    });

    it("reports all orgs as nemoclaw-poc", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "nemoclaw-poc", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      expect(resolver.isNemoclawPoc("org-1")).toBe(true);
      expect(resolver.isNemoclawPoc("org-customer-zero")).toBe(true);
    });

    it("throws if nemoclaw config is missing", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "nemoclaw-poc" },
        DEFAULT_CONFIG,
      );

      expect(() => resolver.resolve("org-1")).toThrow(
        "NemoClaw POC config not available",
      );
    });
  });

  describe("mode: multi", () => {
    it("routes configured orgs to Engine B", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      const config = resolver.resolve("org-customer-zero");
      expect(config.gatewayUrl).toBe("ws://engine-b:18789");
      expect(config.gatewayToken).toBe("token-b");
    });

    it("routes unconfigured orgs to Engine A", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      const config = resolver.resolve("org-other");
      expect(config).toBe(DEFAULT_CONFIG);
    });

    it("correctly reports nemoclaw-poc orgs", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      expect(resolver.isNemoclawPoc("org-customer-zero")).toBe(true);
      expect(resolver.isNemoclawPoc("org-test")).toBe(true);
      expect(resolver.isNemoclawPoc("org-other")).toBe(false);
    });

    it("returns nemoclaw org list", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      expect(resolver.getNemoclawPocOrgIds()).toEqual([
        "org-customer-zero",
        "org-test",
      ]);
    });

    it("inherits all non-URL settings from default config", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      const config = resolver.resolve("org-customer-zero");
      expect(config.provider).toBe("openclaw");
      expect(config.requestTimeoutMs).toBe(120_000);
      expect(config.connectTimeoutMs).toBe(15_000);
      expect(config.retryLimit).toBe(2);
      expect(config.maxRetryDelayMs).toBe(8_000);
      expect(config.runtimePolicy).toBe("strict");
    });

    it("throws if nemoclaw config is missing for routed org", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi" },
        DEFAULT_CONFIG,
      );

      // Empty orgIds means no orgs routed to Engine B
      expect(resolver.resolve("org-1")).toBe(DEFAULT_CONFIG);
    });
  });

  describe("getMode", () => {
    it("returns the current mode", () => {
      const resolver = new OrganizationRuntimeResolver(
        { mode: "multi", nemoclawPoc: NEMOCLAW_CONFIG },
        DEFAULT_CONFIG,
      );

      expect(resolver.getMode()).toBe("multi");
    });
  });
});
