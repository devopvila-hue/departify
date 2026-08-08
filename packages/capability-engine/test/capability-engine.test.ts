/**
 * Sprint 62 — capability-engine deterministic tests.
 *
 * Maps directly to the sprint's test list:
 *   A. Mautic connected → capability READY.
 *   B. Marketing can resolve Mautic contact capability.
 *   C. Mautic disconnected → capability unavailable/degraded.
 *   D. Operational Context contains connected-system state.
 *   E. Memory cannot override connection truth.
 *   F. Department Head cannot claim a READY connection is unavailable.
 *   G. Unknown capability produces acquisition requirement.
 *   H. External/imported capability cannot become READY without validation.
 *   I. Write/consequential capability respects approval policy.
 *   J. (Backend) existing Mautic count operation still works.
 */
import { describe, expect, it } from "vitest";

import {
  buildMauticCapability,
  buildOperationalContext,
  certifyMauticCapability,
  createCapabilityAction,
  DepartmentCapabilityRegistry,
  deriveCapabilityState,
  generatedCapabilityBlockReason,
  registrationBlockReason,
  resolveCapability,
  requiresApproval,
  type CapabilityContract,
  type OperationalConnectionState,
  type OperationalSourcePort,
  type SkillPipelineProgress,
} from "../src/index.js";

function connection(toolId: string, status: OperationalConnectionState["status"]): OperationalConnectionState {
  return { toolId, status };
}

function makeSource(options: {
  mautic?: OperationalConnectionState["status"];
  tools?: Record<string, boolean>;
} = {}): OperationalSourcePort {
  const mauticStatus = options.mautic ?? "connected";
  const tools = options.tools ?? {
    "mautic.contacts.count": true,
    "mautic.contacts.search": true,
    "mautic.test_connection": true,
  };
  const list: OperationalConnectionState[] =
    mauticStatus === "not_connected"
      ? []
      : [connection("mautic", mauticStatus)];
  return {
    connection(toolId) {
      if (toolId === "mautic") {
        return list[0] ?? null;
      }
      return null;
    },
    isToolAvailable(toolId) {
      return tools[toolId] ?? false;
    },
    listConnections() {
      return list;
    },
  };
}

describe("A. Mautic connected → capability READY", () => {
  it("certified Mautic capability becomes ready when the connection is connected", () => {
    const registry = new DepartmentCapabilityRegistry();
    const certified = certifyMauticCapability(
      buildMauticCapability(),
      new Date().toISOString(),
    );
    registry.register(certified);
    const source = makeSource({ mautic: "connected" });
    const states = registry.derive(source);
    const mautic = states.find((s) => s.capability.id === "mautic");
    expect(mautic?.status).toBe("ready");
    expect(mautic?.health).toBe("operational");
    expect(registry.isReady("mautic", source)).toBe(true);
  });

  it("does NOT become ready while verification is still pending", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(buildMauticCapability()); // verification.status = pending
    const states = registry.derive(makeSource({ mautic: "connected" }));
    const mautic = states.find((s) => s.capability.id === "mautic");
    expect(mautic?.status).toBe("validating");
    expect(registry.isReady("mautic", makeSource({ mautic: "connected" }))).toBe(false);
  });
});

describe("B. Marketing can resolve Mautic contact capability", () => {
  it("resolves the Mautic contact capability for Marketing when ready", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const resolution = resolveCapability(registry, makeSource(), {
      department: "marketing",
      objective: "Analiza mis contactos de Mautic.",
      requiredCapability: "contact analysis",
    });
    expect(resolution.outcome).toBe("resolved");
    expect(resolution.resolved?.capability.id).toBe("mautic");
  });

  it("resolves by provider name", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const resolution = resolveCapability(registry, makeSource(), {
      department: "marketing",
      objective: "Revisar el CRM.",
      requiredCapability: "mautic",
    });
    expect(resolution.outcome).toBe("resolved");
  });
});

describe("C. Mautic disconnected → capability unavailable/degraded", () => {
  it("is unavailable when the connection is missing", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const states = registry.derive(makeSource({ mautic: "not_connected" }));
    const mautic = states.find((s) => s.capability.id === "mautic");
    expect(mautic?.status).toBe("unavailable");
    expect(mautic?.health).toBe("down");
  });

  it("is unavailable when the connection is blocked", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const states = registry.derive(makeSource({ mautic: "blocked" }));
    const mautic = states.find((s) => s.capability.id === "mautic");
    expect(mautic?.status).toBe("unavailable");
  });

  it("is degraded when a backing tool is missing", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const source = makeSource({
      mautic: "connected",
      tools: {
        "mautic.contacts.count": false,
        "mautic.contacts.search": true,
        "mautic.test_connection": true,
      },
    });
    const states = registry.derive(source);
    const mautic = states.find((s) => s.capability.id === "mautic");
    expect(mautic?.status).toBe("degraded");
  });
});

describe("D. Operational Context contains connected-system state", () => {
  it("includes connected systems and capability health", () => {
    const ctx = buildOperationalContext({
      company: { name: "MOON Shared Living", goal: "Conseguir más clientes" },
      departments: [
        { id: "marketing", name: "Marketing", head: "Elvira", status: "active" },
      ],
      connections: [connection("mautic", "connected")],
      capabilities: [
        deriveCapabilityState(
          certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
          makeSource(),
        ),
      ],
    });
    expect(ctx.company.name).toBe("MOON Shared Living");
    expect(ctx.connectedSystems.find((s) => s.toolId === "mautic")?.status).toBe("connected");
    expect(ctx.capabilities.find((c) => c.id === "mautic")?.status).toBe("ready");
    expect(ctx.promptView).toContain("SISTEMAS CONECTADOS");
    expect(ctx.promptView).toContain("Mautic");
  });
});

describe("E. Memory cannot override connection truth", () => {
  it("a disconnected connection stays unavailable even if memory claims it is connected", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const source = makeSource({ mautic: "not_connected" });
    // Memory would claim Mautic is connected, but operational source says no.
    const states = registry.derive(source);
    const mautic = states.find((s) => s.capability.id === "mautic");
    expect(mautic?.status).toBe("unavailable");
    // The registry API has no memory input at all — memory can't participate.
    expect(registry.isReady("mautic", source)).toBe(false);
  });
});

describe("F. Department Head cannot claim a READY connection is unavailable", () => {
  it("a connected+verified capability resolves even under a skeptical objective", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const resolution = resolveCapability(registry, makeSource(), {
      department: "marketing",
      objective: "pero ya tienes acceso al mautic",
      requiredCapability: "CRM access",
    });
    expect(resolution.outcome).toBe("resolved");
    expect(resolution.resolved?.state.status).toBe("ready");
  });
});

describe("G. Unknown capability produces acquisition requirement", () => {
  it("yields an acquisition request when nothing matches and nothing is connected", () => {
    const registry = new DepartmentCapabilityRegistry();
    registry.register(
      certifyMauticCapability(buildMauticCapability(), new Date().toISOString()),
    );
    const resolution = resolveCapability(registry, makeSource({ mautic: "not_connected" }), {
      department: "marketing",
      objective: "Enviar una campaña de email.",
      requiredCapability: "email sending",
    });
    expect(resolution.outcome).toBe("acquisition_required");
    expect(resolution.acquisition?.requiredCapability).toBe("email sending");
    expect(resolution.acquisition?.department).toBe("marketing");
  });
});

describe("H. External/imported capability cannot become READY without validation", () => {
  it("registration is blocked when security/sandbox/capability gates are missing", () => {
    const progress: SkillPipelineProgress = {
      skillId: "skill_x",
      provenance: { origin: "mcp.server:untrusted", external: true },
      stage: "capability_tested",
      passed: ["discovered", "inspected", "imported", "normalized"],
      inspection: {
        id: "skill_x",
        name: "External Skill",
        description: "Claims to send email.",
        actions: ["email.send"],
        claimedCapabilities: ["email sending"],
      },
    };
    expect(registrationBlockReason(progress)).toBe("security validation not passed");
  });

  it("generated capability is never READY without deterministic verification", () => {
    const lifecycle = {
      request: {
        requiredCapability: "email sending",
        department: "marketing",
        objective: "Enviar campaña",
      },
      stage: "registered" as const,
      artifact: {
        specification: { capabilityId: "email", name: "Email", description: "x", actions: ["send"] },
        implementationId: "impl_1",
        tested: { passed: true, count: 5 },
        securityValidated: { passed: true, findings: [] },
        sandboxed: { passed: true, findings: [] },
        // capabilityVerified is missing → cannot register.
        registered: true,
      },
    };
    expect(generatedCapabilityBlockReason(lifecycle)).toBe(
      "capability verification not passed",
    );
  });

  it("generated capability registers only after full deterministic verification", () => {
    const lifecycle = {
      request: {
        requiredCapability: "email sending",
        department: "marketing",
        objective: "Enviar campaña",
      },
      stage: "registered" as const,
      artifact: {
        specification: { capabilityId: "email", name: "Email", description: "x", actions: ["send"] },
        implementationId: "impl_1",
        tested: { passed: true, count: 5 },
        securityValidated: { passed: true, findings: [] },
        sandboxed: { passed: true, findings: [] },
        capabilityVerified: { passed: true, evidence: ["test:send-ok"] },
        registered: true,
      },
    };
    expect(generatedCapabilityBlockReason(lifecycle)).toBeNull();
  });
});

describe("I. Write/consequential capability respects approval policy", () => {
  it("consequential risk requires approval", () => {
    expect(
      requiresApproval({ approvalPolicy: "auto", riskLevel: "consequential" }),
    ).toBe(true);
    expect(
      requiresApproval({ approvalPolicy: "requires_approval", riskLevel: "read" }),
    ).toBe(true);
    expect(
      requiresApproval({ approvalPolicy: "auto", riskLevel: "read" }),
    ).toBe(false);
  });

  it("write actions carry the capability's risk level", () => {
    const capability: CapabilityContract = {
      ...buildMauticCapability(),
      writeActions: ["send_campaign"],
      riskLevel: "consequential",
      approvalPolicy: "requires_approval",
      actions: [
        ...buildMauticCapability().actions,
        createCapabilityAction({
          id: "send_campaign",
          name: "Enviar campaña",
          description: "Envía la campaña a los contactos.",
          kind: "write",
          riskLevel: "consequential",
          approvalPolicy: "requires_approval",
        }),
      ],
    };
    expect(requiresApproval(capability)).toBe(true);
  });
});
