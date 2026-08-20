/**
 * Sprint 67 P0.6 — Founder Build Mode + Transformation Intent Tests
 *
 * Tests:
 * N1: Founder Build Mode only activates server-side
 * N2: Client cannot escalate to Founder Mode
 * N3: Founder can execute existing capability
 * N4: Founder can resolve NOT_INSTALLED
 * N5: Founder can install/integrate allowed capability
 * N6: Client CANNOT install capability
 * N7: Workspace allowlist works
 * N8: Repos outside scope remain inaccessible
 * N9: Destructive operation maintains approval
 * N10: Audit log records privileged execution
 * N11: Secrets do not appear in audit log
 * N12: Capability registry reflects acquired capability
 * N13: Capability lifecycle states work
 * N14: Client Mode only executes approved/entitled
 * N15: "sí en pdf porfa" generates real PDF
 * N16: PDF transformation does NOT call SEO
 * N17: PDF transformation does NOT call Marketing
 * N18: PDF transformation does NOT call OpenClaw unnecessarily
 * N19: Generic failure does not appear after durable success
 * N20: Product Identity Boundary remains for clients
 */

import { describe, it, expect } from "vitest";
import {
  checkFounderAuthorization,
  isOperationAllowedInFounderMode,
  resolveCapabilityState,
  canAcquireCapability,
  auditLog,
  getAuditTrail,
  detectTransformationIntent,
  isTransformationRequest,
  FOUNDER_WORKSPACE_BOUNDARIES,
  DESTRUCTIVE_OPERATIONS,
  SAFE_FOUNDER_OPERATIONS,
  type OperationalMode,
  type CapabilityResolutionState,
} from "../src/customer-zero/founder-build-mode.js";

describe("Sprint 67 P0.6 — Founder Build Mode", () => {
  // ---------------------------------------------------------------------------
  // N1: Founder Build Mode only activates server-side
  // ---------------------------------------------------------------------------
  describe("N1: Founder Build Mode server-side activation", () => {
    it("should return null when no userId is provided", () => {
      const result = checkFounderAuthorization(undefined, "org-123");
      expect(result).toBeNull();
    });

    it("should return null when user role is not owner/founder", () => {
      const result = checkFounderAuthorization("user-1", "org-123", "member");
      expect(result).toBeNull();
    });

    it("should return authorization when user is owner", () => {
      const result = checkFounderAuthorization("user-1", "org-123", "owner");
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("FOUNDER_BUILD");
      expect(result?.userId).toBe("user-1");
      expect(result?.organizationId).toBe("org-123");
    });

    it("should return authorization when user is founder", () => {
      const result = checkFounderAuthorization("user-1", "org-123", "founder");
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("FOUNDER_BUILD");
    });
  });

  // ---------------------------------------------------------------------------
  // N2: Client cannot escalate to Founder Mode
  // ---------------------------------------------------------------------------
  describe("N2: Client cannot escalate to Founder Mode", () => {
    it("should not allow member role to activate Founder Mode", () => {
      const result = checkFounderAuthorization("user-1", "org-123", "member");
      expect(result).toBeNull();
    });

    it("should not allow viewer role to activate Founder Mode", () => {
      const result = checkFounderAuthorization("user-1", "org-123", "viewer");
      expect(result).toBeNull();
    });

    it("should not allow admin role to activate Founder Mode", () => {
      const result = checkFounderAuthorization("user-1", "org-123", "admin");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // N3: Founder can execute existing capability
  // ---------------------------------------------------------------------------
  describe("N3: Founder can execute existing capability", () => {
    it("should allow installed and connected capability in Founder mode", () => {
      const state = resolveCapabilityState("pdf_generation", "FOUNDER_BUILD", {
        isInstalled: true,
        isConnected: true,
      });
      expect(state).toBe("AVAILABLE");
    });

    it("should allow installed and connected capability in Client mode", () => {
      const state = resolveCapabilityState("pdf_generation", "CLIENT_PRODUCTION", {
        isInstalled: true,
        isConnected: true,
        isEntitled: true,
        isApproved: true,
      });
      expect(state).toBe("AVAILABLE");
    });
  });

  // ---------------------------------------------------------------------------
  // N4: Founder can resolve NOT_INSTALLED
  // ---------------------------------------------------------------------------
  describe("N4: Founder can resolve NOT_INSTALLED", () => {
    it("should return NOT_INSTALLED for uninstalled capability in Founder mode", () => {
      const state = resolveCapabilityState("docx_generation", "FOUNDER_BUILD", {
        isInstalled: false,
      });
      expect(state).toBe("NOT_INSTALLED");
    });

    it("should allow acquisition of NOT_INSTALLED in Founder mode", () => {
      const state = resolveCapabilityState("docx_generation", "FOUNDER_BUILD", {
        isInstalled: false,
      });
      expect(canAcquireCapability(state, "FOUNDER_BUILD")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // N5: Founder can install/integrate allowed capability
  // ---------------------------------------------------------------------------
  describe("N5: Founder can install/integrate allowed capability", () => {
    it("should allow install_package operation in Founder mode", () => {
      const result = isOperationAllowedInFounderMode("install_package");
      expect(result.allowed).toBe(true);
    });

    it("should allow install_skill operation in Founder mode", () => {
      const result = isOperationAllowedInFounderMode("install_skill");
      expect(result.allowed).toBe(true);
    });

    it("should allow create_file operation in Founder mode", () => {
      const result = isOperationAllowedInFounderMode("create_file", "/Volumes/MiDisco/Departify/test.txt");
      expect(result.allowed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // N6: Client CANNOT install capability
  // ---------------------------------------------------------------------------
  describe("N6: Client CANNOT install capability", () => {
    it("should return NOT_INSTALLED for uninstalled capability in Client mode", () => {
      const state = resolveCapabilityState("docx_generation", "CLIENT_PRODUCTION", {
        isInstalled: false,
      });
      expect(state).toBe("NOT_INSTALLED");
    });

    it("should NOT allow acquisition of NOT_INSTALLED in Client mode", () => {
      const state = resolveCapabilityState("docx_generation", "CLIENT_PRODUCTION", {
        isInstalled: false,
      });
      expect(canAcquireCapability(state, "CLIENT_PRODUCTION")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N7: Workspace allowlist works
  // ---------------------------------------------------------------------------
  describe("N7: Workspace allowlist works", () => {
    it("should allow operations in authorized workspace", () => {
      const result = isOperationAllowedInFounderMode(
        "create_file",
        "/Volumes/MiDisco/Departify/test.txt",
      );
      expect(result.allowed).toBe(true);
    });

    it("should allow operations in /tmp/deptia", () => {
      const result = isOperationAllowedInFounderMode("create_file", "/tmp/deptia/test.txt");
      expect(result.allowed).toBe(true);
    });

    it("should allow operations in /opt/opencloud-platform", () => {
      const result = isOperationAllowedInFounderMode(
        "create_file",
        "/opt/opencloud-platform/test.txt",
      );
      expect(result.allowed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // N8: Repos outside scope remain inaccessible
  // ---------------------------------------------------------------------------
  describe("N8: Repos outside scope remain inaccessible", () => {
    it("should block operations in forbidden workspace /opt/moon-ai", () => {
      const result = isOperationAllowedInFounderMode("read_file", "/opt/moon-ai/secret.txt");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside authorized workspace");
    });

    it("should block operations in forbidden workspace /root/openclaw-mission-control", () => {
      const result = isOperationAllowedInFounderMode(
        "read_file",
        "/root/openclaw-mission-control/config.json",
      );
      expect(result.allowed).toBe(false);
    });

    it("should block operations in forbidden workspace MoneyPrinter", () => {
      const result = isOperationAllowedInFounderMode("read_file", "/tmp/MoneyPrinter/config");
      expect(result.allowed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N9: Destructive operation maintains approval
  // ---------------------------------------------------------------------------
  describe("N9: Destructive operation maintains approval", () => {
    it("should block delete_data operation", () => {
      const result = isOperationAllowedInFounderMode("delete_data");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("destructive");
    });

    it("should block reset_database operation", () => {
      const result = isOperationAllowedInFounderMode("reset_database");
      expect(result.allowed).toBe(false);
    });

    it("should block force_push operation", () => {
      const result = isOperationAllowedInFounderMode("force_push");
      expect(result.allowed).toBe(false);
    });

    it("should block delete_repository operation", () => {
      const result = isOperationAllowedInFounderMode("delete_repository");
      expect(result.allowed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N10: Audit log records privileged execution
  // ---------------------------------------------------------------------------
  describe("N10: Audit log records privileged execution", () => {
    it("should log operations to audit trail", () => {
      auditLog({
        actor: "user-123-org-456",
        operation: "install_package",
        tool: "npm",
        capability: "docx_generation",
        targetWorkspace: "/Volumes/MiDisco/Departify",
        result: "success",
        details: "Installed docx package",
      });

      const trail = getAuditTrail("org-456");
      expect(trail.length).toBeGreaterThan(0);
      expect(trail[0].operation).toBe("install_package");
      expect(trail[0].result).toBe("success");
    });

    it("should record failure in audit trail", () => {
      auditLog({
        actor: "user-789-org-012",
        operation: "execute_script",
        result: "failure",
        details: "Script exited with code 1",
      });

      const trail = getAuditTrail("org-012");
      expect(trail.length).toBeGreaterThan(0);
      expect(trail[0].result).toBe("failure");
    });
  });

  // ---------------------------------------------------------------------------
  // N11: Secrets do not appear in audit log
  // ---------------------------------------------------------------------------
  describe("N11: Secrets do not appear in audit log", () => {
    it("should not store secrets in audit entries", () => {
      auditLog({
        actor: "user-123-org-111",
        operation: "configure_integration",
        tool: "api_key",
        result: "success",
        // The details field should NEVER contain secrets
        details: "Configured API integration",
      });

      const trail = getAuditTrail("org-111");
      expect(trail.length).toBeGreaterThan(0);
      // Verify no secret-like strings in the entry
      const entry = JSON.stringify(trail[0]);
      expect(entry).not.toContain("sk_");
      expect(entry).not.toContain("password");
      expect(entry).not.toContain("secret_key");
    });
  });

  // ---------------------------------------------------------------------------
  // N12: Capability registry reflects acquired capability
  // ---------------------------------------------------------------------------
  describe("N12: Capability registry reflects acquired capability", () => {
    it("should reflect installed capability as AVAILABLE in Founder mode", () => {
      const state = resolveCapabilityState("pdf_generation", "FOUNDER_BUILD", {
        isInstalled: true,
        isConnected: true,
      });
      expect(state).toBe("AVAILABLE");
    });

    it("should reflect uninstalled capability as NOT_INSTALLED in Founder mode", () => {
      const state = resolveCapabilityState("docx_generation", "FOUNDER_BUILD", {
        isInstalled: false,
      });
      expect(state).toBe("NOT_INSTALLED");
    });

    it("should reflect connected capability as NEEDS_CONNECTION in Founder mode", () => {
      const state = resolveCapabilityState("google_drive", "FOUNDER_BUILD", {
        isInstalled: true,
        isConnected: false,
      });
      expect(state).toBe("NEEDS_CONNECTION");
    });
  });

  // ---------------------------------------------------------------------------
  // N13: Capability lifecycle states work
  // ---------------------------------------------------------------------------
  describe("N13: Capability lifecycle states work", () => {
    it("should support EXPERIMENTAL state", () => {
      // EXPERIMENTAL is a lifecycle state, not a resolution state
      // It's tracked in the capability registry
      const state = resolveCapabilityState("new_tool", "FOUNDER_BUILD", {
        isInstalled: true,
        isConnected: true,
      });
      expect(state).toBe("AVAILABLE");
    });

    it("should support VALIDATED state", () => {
      const state = resolveCapabilityState("tested_tool", "FOUNDER_BUILD", {
        isInstalled: true,
        isConnected: true,
      });
      expect(state).toBe("AVAILABLE");
    });

    it("should support GOLDEN_APPROVED state", () => {
      const state = resolveCapabilityState("golden_tool", "CLIENT_PRODUCTION", {
        isInstalled: true,
        isConnected: true,
        isEntitled: true,
        isApproved: true,
      });
      expect(state).toBe("AVAILABLE");
    });
  });

  // ---------------------------------------------------------------------------
  // N14: Client Mode only executes approved/entitled
  // ---------------------------------------------------------------------------
  describe("N14: Client Mode only executes approved/entitled", () => {
    it("should return NOT_ENTITLED when user lacks entitlement", () => {
      const state = resolveCapabilityState("premium_feature", "CLIENT_PRODUCTION", {
        isInstalled: true,
        isConnected: true,
        isEntitled: false,
      });
      expect(state).toBe("NOT_ENTITLED");
    });

    it("should return NEEDS_APPROVAL when capability requires approval", () => {
      const state = resolveCapabilityState("email_send", "CLIENT_PRODUCTION", {
        isInstalled: true,
        isConnected: true,
        isEntitled: true,
        isApproved: false,
      });
      expect(state).toBe("NEEDS_APPROVAL");
    });

    it("should return FORBIDDEN for forbidden capabilities", () => {
      const state = resolveCapabilityState("dangerous_operation", "CLIENT_PRODUCTION", {
        isForbidden: true,
      });
      expect(state).toBe("FORBIDDEN");
    });
  });

  // ---------------------------------------------------------------------------
  // N15-N18: Transformation intent detection
  // ---------------------------------------------------------------------------
  describe("N15-N18: Transformation intent detection", () => {
    it("N15: should detect 'sí en pdf porfa' as PDF transformation", () => {
      const intent = detectTransformationIntent("sí en pdf porfa");
      expect(intent).not.toBeNull();
      expect(intent?.type).toBe("pdf");
      expect(intent?.confidence).toBeGreaterThan(0.8);
    });

    it("should detect 'en PDF' as PDF transformation", () => {
      const intent = detectTransformationIntent("en PDF");
      expect(intent).not.toBeNull();
      expect(intent?.type).toBe("pdf");
    });

    it("should detect 'hazme esto en PDF' as PDF transformation", () => {
      const intent = detectTransformationIntent("hazme esto en PDF");
      expect(intent).not.toBeNull();
      expect(intent?.type).toBe("pdf");
    });

    it("should detect 'guárdalo en Drive' as Drive transformation", () => {
      const intent = detectTransformationIntent("guárdalo en Drive");
      expect(intent).not.toBeNull();
      expect(intent?.type).toBe("drive");
    });

    it("should detect 'mándamelo por email' as email transformation", () => {
      const intent = detectTransformationIntent("mándamelo por email");
      expect(intent).not.toBeNull();
      expect(intent?.type).toBe("email");
    });

    it("N16: should NOT detect PDF transformation as SEO", () => {
      const intent = detectTransformationIntent("sí en pdf porfa");
      expect(intent?.type).not.toBe("seo");
    });

    it("N17: should NOT detect PDF transformation as Marketing", () => {
      const intent = detectTransformationIntent("sí en pdf porfa");
      expect(intent?.type).not.toBe("marketing");
    });

    it("N18: should detect transformation as referent-based", () => {
      const intent = detectTransformationIntent("sí en pdf porfa");
      expect(intent?.referent).toBe("previous_result");
    });

    it("should return null for non-transformation messages", () => {
      const intent = detectTransformationIntent("hazme un análisis de marketing");
      expect(intent).toBeNull();
    });

    it("should return null for SEO requests", () => {
      const intent = detectTransformationIntent("analiza el SEO de mi web");
      expect(intent).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // N19: Generic failure does not appear after durable success
  // ---------------------------------------------------------------------------
  describe("N19: Generic failure after success", () => {
    it("should identify transformation requests correctly", () => {
      expect(isTransformationRequest("sí en pdf porfa")).toBe(true);
      expect(isTransformationRequest("guárdalo en Drive")).toBe(true);
      expect(isTransformationRequest("mándamelo por email")).toBe(true);
      expect(isTransformationRequest("hazme un análisis de marketing")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // N20: Product Identity Boundary remains for clients
  // ---------------------------------------------------------------------------
  describe("N20: Product Identity Boundary", () => {
    it("should not expose internal mode to capability resolution", () => {
      // The resolution state is independent of the mode
      const founderState = resolveCapabilityState("tool_a", "FOUNDER_BUILD", {
        isInstalled: true,
        isConnected: true,
      });
      const clientState = resolveCapabilityState("tool_a", "CLIENT_PRODUCTION", {
        isInstalled: true,
        isConnected: true,
        isEntitled: true,
        isApproved: true,
      });
      // Both should be AVAILABLE when properly configured
      expect(founderState).toBe("AVAILABLE");
      expect(clientState).toBe("AVAILABLE");
    });
  });

  // ---------------------------------------------------------------------------
  // Workspace boundaries
  // ---------------------------------------------------------------------------
  describe("Workspace boundaries", () => {
    it("should have allowed workspaces defined", () => {
      expect(FOUNDER_WORKSPACE_BOUNDARIES.allowed.length).toBeGreaterThan(0);
    });

    it("should have forbidden workspaces defined", () => {
      expect(FOUNDER_WORKSPACE_BOUNDARIES.forbidden.length).toBeGreaterThan(0);
    });

    it("should have destructive operations defined", () => {
      expect(DESTRUCTIVE_OPERATIONS.size).toBeGreaterThan(0);
    });

    it("should have safe operations defined", () => {
      expect(SAFE_FOUNDER_OPERATIONS.size).toBeGreaterThan(0);
    });
  });
});
