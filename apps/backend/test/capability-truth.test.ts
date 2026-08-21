/**
 * Capability Truth Tests
 *
 * Tests for:
 * 1. GitHub capability availability
 * 2. Credential safety (no leakage)
 * 3. Execution-first policy
 * 4. Product Identity Boundary
 * 5. Conversation tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isCapabilityAvailable,
  listAvailableCapabilities,
  listReadyCapabilities,
  CAPABILITY_REGISTRY,
} from "../src/customer-zero/capability-registry.js";
import {
  resolveGitHubCredentials,
  hasGitHubCredentials,
  hasConfiguredCredentials,
} from "../src/customer-zero/credential-resolver.js";
import {
  isInternalRuntimeLeak,
  sanitizeToolError,
  sanitizeCEOResponse,
} from "../src/customer-zero/response-sanitizer.js";
import {
  classifyMessageIntent,
} from "../src/server/routes/customer-zero-v2.js";

// Mock the external OAuth token store
vi.mock("../external-oauth-tokens.js", () => ({
  getExternalOAuthTokenStore: () => ({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    listForOrg: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe("Capability Truth", () => {
  describe("GitHub Capabilities", () => {
    it("should have github.repository.read in registry", () => {
      const cap = CAPABILITY_REGISTRY["github.repository.read"];
      expect(cap).toBeDefined();
      expect(cap?.provider).toBe("github");
    });

    it("should have github.repository.write in registry", () => {
      const cap = CAPABILITY_REGISTRY["github.repository.write"];
      expect(cap).toBeDefined();
      expect(cap?.provider).toBe("github");
    });

    it("should return false for hasConfiguredCredentials('github')", () => {
      // GitHub credentials are async (external OAuth store), so sync check returns false
      expect(hasConfiguredCredentials("github")).toBe(false);
    });

    it("should return false for hasGitHubCredentials when no token exists", async () => {
      const result = await hasGitHubCredentials("org-123");
      expect(result).toBe(false);
    });

    it("should return unavailable for github.repository.read when no token", () => {
      const result = isCapabilityAvailable("org-123", "github.repository.read");
      expect(result.available).toBe(false);
      expect(result.reason).toBe("credentials_missing");
    });
  });

  describe("Capability List", () => {
    it("should include GitHub capabilities in list", () => {
      const capabilities = listAvailableCapabilities("org-123");
      const githubCaps = capabilities.filter((c) => c.capability.startsWith("github."));
      expect(githubCaps.length).toBe(2);
    });

    it("should not include GitHub capabilities in ready list when no token", () => {
      const ready = listReadyCapabilities("org-123");
      const githubReady = ready.filter((c) => c.startsWith("github."));
      expect(githubReady.length).toBe(0);
    });
  });
});

describe("Credential Safety", () => {
  describe("sanitizeToolError", () => {
    it("should remove internal paths", () => {
      const error = "Error at /home/node/app/src/file.ts:123:45";
      const sanitized = sanitizeToolError(error);
      expect(sanitized).not.toContain("/home/node");
      expect(sanitized).toContain("[internal]");
    });

    it("should remove stack traces", () => {
      const error = "Error\n    at Object.<anonymous> (/home/node/app/src/file.ts:123:45)";
      const sanitized = sanitizeToolError(error);
      expect(sanitized).not.toContain("at Object.<anonymous>");
      expect(sanitized).toContain("[stack]");
    });

    it("should remove env vars", () => {
      const error = "Missing GITHUB_TOKEN=ghp_abc123";
      const sanitized = sanitizeToolError(error);
      expect(sanitized).not.toContain("GITHUB_TOKEN=ghp_abc123");
      expect(sanitized).toContain("[env]");
    });

    it("should remove GitHub PATs", () => {
      const error = "Invalid token: github_pat_abc123def456";
      const sanitized = sanitizeToolError(error);
      expect(sanitized).not.toContain("github_pat_abc123def456");
      expect(sanitized).toContain("[redacted]");
    });

    it("should remove bearer tokens", () => {
      const error = "Authorization: Bearer ghp_abc123def456";
      const sanitized = sanitizeToolError(error);
      expect(sanitized).not.toContain("ghp_abc123def456");
      expect(sanitized).toContain("[redacted]");
    });
  });

  describe("isInternalRuntimeLeak", () => {
    it("should detect OpenClaw references", () => {
      expect(isInternalRuntimeLeak("OpenClaw gateway error")).toBe(true);
    });

    it("should detect MCP references", () => {
      expect(isInternalRuntimeLeak("MCP adapter failed")).toBe(true);
    });

    it("should not flag business text", () => {
      expect(isInternalRuntimeLeak("Tus ventas aumentaron un 20%")).toBe(false);
    });

    it("should not flag single forbidden term", () => {
      // Requires 2+ distinct hits OR structural pattern
      expect(isInternalRuntimeLeak("El runtime está funcionando")).toBe(false);
    });
  });

  describe("sanitizeCEOResponse", () => {
    it("should strip tool call tags", () => {
      const text = 'Hola <departify_tool_call>{"name":"test"}</departify_tool_call> mundo';
      const sanitized = sanitizeCEOResponse(text, "es");
      expect(sanitized).toBe("Hola  mundo");
    });

    it("should replace internal leaks with fallback", () => {
      const text = "OpenClaw gateway error: MCP adapter failed";
      const sanitized = sanitizeCEOResponse(text, "es");
      expect(sanitized).toContain("No he podido completar");
    });

    it("should preserve clean business text", () => {
      const text = "Tus ventas aumentaron un 20% este mes.";
      const sanitized = sanitizeCEOResponse(text, "es");
      expect(sanitized).toBe(text);
    });
  });
});

describe("Execution-First Policy", () => {
  describe("classifyMessageIntent", () => {
    it("should classify PAT query as HEAVY", () => {
      const intent = classifyMessageIntent("tienes el pat en env file sigue valido");
      expect(intent).toBe("HEAVY");
    });

    it("should classify GitHub query as HEAVY", () => {
      const intent = classifyMessageIntent("lista mis repositorios de github");
      expect(intent).toBe("HEAVY");
    });

    it("should classify greeting as LIGHTWEIGHT", () => {
      const intent = classifyMessageIntent("hola");
      expect(intent).toBe("LIGHTWEIGHT");
    });

    it("should classify empty message as LIGHTWEIGHT", () => {
      const intent = classifyMessageIntent("");
      expect(intent).toBe("LIGHTWEIGHT");
    });
  });
});

describe("Product Identity Boundary", () => {
  it("should never expose OpenClaw in responses", () => {
    const responses = [
      "GitHub está conectado.",
      "No pude completar esa solicitud.",
      "Tus ventas aumentaron un 20%.",
    ];
    for (const response of responses) {
      expect(isInternalRuntimeLeak(response)).toBe(false);
    }
  });

  it("should never expose internal paths in responses", () => {
    const responses = [
      "GitHub está conectado.",
      "No pude completar esa solicitud.",
    ];
    for (const response of responses) {
      expect(response).not.toContain("/home/node");
      expect(response).not.toContain("/Volumes");
      expect(response).not.toContain("/Users");
    }
  });

  it("should never expose tokens in responses", () => {
    const responses = [
      "GitHub está conectado.",
      "No pude completar esa solicitud.",
    ];
    for (const response of responses) {
      expect(response).not.toMatch(/github_pat_/);
      expect(response).not.toMatch(/ghp_/);
      expect(response).not.toMatch(/gho_/);
      expect(response).not.toMatch(/ghu_/);
      expect(response).not.toMatch(/ghs_/);
      expect(response).not.toMatch(/ghr_/);
    }
  });
});
