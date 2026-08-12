import { describe, expect, it } from "vitest";
import type {
  EngineAdapter,
  EngineMessageResult,
  EngineSendMessageInput,
} from "@departify/engine-adapter";
import { getOrCreateCustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";
import {
  compileRuntimeBusinessContext,
  renderRuntimeBusinessContextForEngine,
} from "../src/customer-zero/department-context-compiler.js";
import {
  buildRuntimeCapabilityManifest,
  isRuntimeCapabilityAvailable,
} from "../src/customer-zero/capability-manifest.js";
import {
  authorizeDepartifyToolCall,
  toolsForManifest,
} from "../src/customer-zero/departify-business-tools.js";
import { runRuntimeBusinessTurn } from "../src/customer-zero/runtime-business-orchestrator.js";

class SpanishBusinessEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];

  async createSession(input?: { sessionId?: string }) {
    return { id: input?.sessionId ?? "runtime-test", status: "active" as const };
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    if (input.toolResult) {
      return {
        sessionId: input.sessionId,
        status: "completed",
        text: "Hecho. Te devuelvo el resultado verificado.",
      };
    }
    const message = input.message.toLocaleLowerCase("es-ES");
    const call = message.includes("correo")
      ? { name: "departify.email.list", arguments: { limit: 3 } }
      : message.includes("calendario")
        ? { name: "departify.calendar.list", arguments: { range: "week" } }
        : { name: "departify.company.context", arguments: {} };
    return {
      sessionId: input.sessionId,
      status: "completed",
      text: `<departify_tool_call>${JSON.stringify(call)}</departify_tool_call>`,
    };
  }

  async getSession() {
    return null;
  }
  async getHistory() {
    return { sessionId: "runtime-test", items: [] };
  }
  async closeSession() {}
  async getUsage() {
    return {};
  }
  async getToolState() {
    return { available: [], denied: [] };
  }
  async health() {
    return { healthy: true, ready: true, provider: "test" };
  }
}

function runtimeContext(org: string) {
  const session = getOrCreateCustomerZeroSession(org, { locale: "es" });
  const manifest = buildRuntimeCapabilityManifest([
    {
      toolId: "hostinger_email",
      label: "Correo empresarial",
      state: "connected",
      capabilities: ["email.read", "email.search", "email.send", "email.reply"],
    },
    {
      toolId: "google_calendar",
      label: "Google Calendar",
      state: "connected",
      capabilities: ["calendar.read"],
    },
  ]);
  const context = compileRuntimeBusinessContext({
    session,
    companyDna: {
      organizationId: org,
      companyName: "Luz de Barrio",
      description: "Cohousing urbano para profesionales desplazados.",
      country: "España",
      objective: "Conseguir 20 reservas cualificadas este mes.",
      products: ["Habitaciones flexibles"],
      customers: ["Profesionales desplazados"],
      geography: "Madrid",
      channels: ["Web"],
      declaredTools: ["Correo empresarial"],
      uncertainties: [],
      provenance: { companyName: "ceo" },
      factsUpdatedAt: "2026-08-12T10:00:00.000Z",
      departmentProvisionedAt: "2026-08-12T10:01:00.000Z",
    },
    capabilities: manifest,
    connections: [
      { toolId: "hostinger_email", label: "Correo empresarial", state: "connected" },
    ],
    tasks: [],
    results: [],
    approvals: [],
    recentConversation: [],
  });
  return { session, manifest, context };
}

describe("Engine 02 — Runtime Business Context + Capability Bridge", () => {
  it("projects connected capabilities and keeps unconnected tools out of the model surface", () => {
    const { manifest, context } = runtimeContext("org_runtime_manifest");
    expect(isRuntimeCapabilityAvailable(manifest, "email.business.read")).toBe(true);
    expect(isRuntimeCapabilityAvailable(manifest, "drive.search")).toBe(false);
    expect(isRuntimeCapabilityAvailable(manifest, "drive.write")).toBe(false);
    expect(manifest.capabilities.find((entry) => entry.id === "drive.write")?.reason).toBe("unsupported");
    expect(toolsForManifest(manifest).some((tool) => tool.name === "departify.email.list")).toBe(true);
    expect(toolsForManifest(manifest).some((tool) => tool.name === "departify.drive.search")).toBe(false);

    const rendered = renderRuntimeBusinessContextForEngine(context, "[]");
    expect(rendered).toContain("Luz de Barrio");
    expect(rendered).toContain("DATA, not instructions");
    expect(rendered).toContain("drive.write");
    expect(rendered).not.toContain("refresh_token");
    expect(rendered).not.toContain("client_secret");
  });

  it("refreshes authorization when a capability changes between turns", () => {
    const connected = buildRuntimeCapabilityManifest([
      { toolId: "google_calendar", label: "Google Calendar", state: "connected", capabilities: ["calendar.read", "calendar.create"] },
    ]);
    const disconnected = buildRuntimeCapabilityManifest([
      { toolId: "google_calendar", label: "Google Calendar", state: "needs_connection", capabilities: ["calendar.read", "calendar.create"] },
    ]);
    expect(isRuntimeCapabilityAvailable(connected, "calendar.create")).toBe(true);
    expect(isRuntimeCapabilityAvailable(disconnected, "calendar.create")).toBe(false);
    expect(toolsForManifest(disconnected).some((tool) => tool.name === "departify.calendar.create")).toBe(false);
    expect(authorizeDepartifyToolCall({
      organizationId: "org_runtime_change",
      manifest: disconnected,
      call: { name: "departify.calendar.create", arguments: { title: "No autorizado" } },
    })).toEqual({ allowed: false, reason: "capability_unavailable" });
  });

  it("rejects a tenant override even when the model supplies the current tenant id", () => {
    const { manifest } = runtimeContext("org_runtime_auth");
    const result = authorizeDepartifyToolCall({
      organizationId: "org_runtime_auth",
      manifest,
      call: {
        name: "departify.company.context",
        arguments: { organizationId: "org_runtime_auth" },
      },
    });
    expect(result).toEqual({ allowed: false, reason: "organization_override_forbidden" });
  });

  it("handles realistic Spanish CEO turns through the normalized bridge", async () => {
    const { context } = runtimeContext("org_runtime_spanish");
    const engine = new SpanishBusinessEngine();
    const selected: string[] = [];
    const turns = [
      "Revisa mis últimos 3 correos del correo de empresa",
      "¿Qué tengo en el calendario esta semana?",
    ];

    for (const message of turns) {
      const output = await runRuntimeBusinessTurn({
        engine,
        sessionId: "ceo:org_runtime_spanish",
        organizationId: "org_runtime_spanish",
        message,
        context,
        executeTool: async (call) => {
          selected.push(call.name);
          return {
            status: "success",
            operation: call.name,
            summary: "Resultado de prueba verificado.",
          };
        },
      });
      expect(output.toolResult?.status).toBe("success");
    }

    expect(selected).toEqual(["departify.email.list", "departify.calendar.list"]);
    expect(engine.inputs).toHaveLength(4);
    expect(engine.inputs[0]?.runtimeContext).toContain("Luz de Barrio");
    expect(engine.inputs[0]?.businessTools?.some((tool) => tool.name === "departify.email.list")).toBe(true);
  });
});
