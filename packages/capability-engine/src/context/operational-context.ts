/**
 * Operational Context — Sprint 62.
 *
 * The canonical snapshot a Department Head receives BEFORE reasoning. It makes
 * the failure class from Customer Zero testing impossible by design:
 *
 *   CEO: "¿Cuántos contactos tenemos?"        → Departify: "2260".
 *   CEO: "pero ya tienes acceso al mautic"    → Departify MUST NOT say it needs
 *                                                CRM access again.
 *
 * Operational state OUTRANKS conversational inference. The LLM receives this
 * context and can never invent connection state, because connected systems and
 * capability health are facts here, not memory.
 */

import type { CapabilityContract, CapabilityHealth } from "../contracts/capability-contract.js";
import type { DerivedCapabilityState } from "../registry/department-capability-registry.js";
import type { OperationalConnectionState } from "../contracts/operational-source-port.js";

export interface OperationalContextCompany {
  readonly name: string;
  readonly goal?: string;
}

export interface OperationalContextDepartment {
  readonly id: string;
  readonly name: string;
  readonly head: string;
  readonly status: "active" | "future";
}

export interface OperationalContextSystem {
  readonly toolId: string;
  readonly label: string;
  readonly status: string;
  readonly capability?: string;
}

export interface OperationalContextCapability {
  readonly id: string;
  readonly name: string;
  readonly department: string;
  readonly status: string;
  readonly health: CapabilityHealth;
  readonly readActions: readonly string[];
  readonly writeActions: readonly string[];
}

export interface OperationalContextTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface OperationalContextApproval {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface OperationalContextMemory {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly provenance: string;
}

export interface OperationalContext {
  readonly company: OperationalContextCompany;
  readonly departments: readonly OperationalContextDepartment[];
  readonly connectedSystems: readonly OperationalContextSystem[];
  readonly capabilities: readonly OperationalContextCapability[];
  readonly activeTasks: readonly OperationalContextTask[];
  readonly pendingApprovals: readonly OperationalContextApproval[];
  readonly recentToolResults: readonly { toolId: string; ok: boolean; summary: string }[];
  readonly companyMemory: readonly OperationalContextMemory[];
  readonly departmentMemory: readonly OperationalContextMemory[];
  /** A canonical, CEO-safe summary for prompting. */
  readonly promptView: string;
}

export interface OperationalContextInput {
  readonly company: OperationalContextCompany;
  readonly departments: readonly OperationalContextDepartment[];
  readonly connections: readonly OperationalConnectionState[];
  readonly capabilities: readonly DerivedCapabilityState[];
  readonly activeTasks?: readonly OperationalContextTask[];
  readonly pendingApprovals?: readonly OperationalContextApproval[];
  readonly recentToolResults?: readonly { toolId: string; ok: boolean; summary: string }[];
  readonly companyMemory?: readonly OperationalContextMemory[];
  readonly departmentMemory?: readonly OperationalContextMemory[];
}

export function buildOperationalContext(
  input: OperationalContextInput,
): OperationalContext {
  const connectedSystems: OperationalContextSystem[] = input.connections.map(
    (connection) => {
      const capability = capabilityFor(connection.toolId);
      return {
        toolId: connection.toolId,
        label: humanizeToolId(connection.toolId),
        status: connection.status,
        ...(capability ? { capability } : {}),
      };
    },
  );

  const capabilities: OperationalContextCapability[] = input.capabilities.map(
    (entry) => ({
      id: entry.capability.id,
      name: entry.capability.name,
      department: entry.capability.department,
      status: entry.status,
      health: entry.health,
      readActions: entry.capability.readActions,
      writeActions: entry.capability.writeActions,
    }),
  );

  const promptView = buildPromptView({
    company: input.company,
    departments: input.departments,
    connectedSystems,
    capabilities,
    activeTasks: input.activeTasks ?? [],
    pendingApprovals: input.pendingApprovals ?? [],
    recentToolResults: input.recentToolResults ?? [],
    companyMemory: input.companyMemory ?? [],
    departmentMemory: input.departmentMemory ?? [],
  });

  return {
    company: input.company,
    departments: input.departments,
    connectedSystems,
    capabilities,
    activeTasks: input.activeTasks ?? [],
    pendingApprovals: input.pendingApprovals ?? [],
    recentToolResults: input.recentToolResults ?? [],
    companyMemory: input.companyMemory ?? [],
    departmentMemory: input.departmentMemory ?? [],
    promptView,
  };
}

function buildPromptView(ctx: {
  company: OperationalContextCompany;
  departments: readonly OperationalContextDepartment[];
  connectedSystems: readonly OperationalContextSystem[];
  capabilities: readonly OperationalContextCapability[];
  activeTasks: readonly OperationalContextTask[];
  pendingApprovals: readonly OperationalContextApproval[];
  recentToolResults: readonly { toolId: string; ok: boolean; summary: string }[];
  companyMemory: readonly OperationalContextMemory[];
  departmentMemory: readonly OperationalContextMemory[];
}): string {
  const lines: string[] = [];
  lines.push(`EMPRESA: ${ctx.company.name}${ctx.company.goal ? ` — OBJETIVO: ${ctx.company.goal}` : ""}`);
  lines.push(
    `DEPARTAMENTOS: ${ctx.departments
      .map((d) => `${d.name} (${d.status}, ${d.head})`)
      .join(", ") || "ninguno"}`,
  );
  const connected =
    ctx.connectedSystems.length > 0
      ? ctx.connectedSystems
          .map((s) => `${s.label} (${s.status})`)
          .join(", ")
      : "ninguna";
  lines.push(`SISTEMAS CONECTADOS: ${connected}`);
  const caps =
    ctx.capabilities.length > 0
      ? ctx.capabilities
          .map((c) => `${c.name} (${c.status}${c.health !== "operational" ? `, ${c.health}` : ""})`)
          .join(", ")
      : "ninguna";
  lines.push(`CAPACIDADES DISPONIBLES: ${caps}`);
  if (ctx.activeTasks.length > 0) {
    lines.push(
      `TRABAJO EN CURSO: ${ctx.activeTasks
        .map((t) => `${t.title} (${t.status})`)
        .join(", ")}`,
    );
  }
  if (ctx.pendingApprovals.length > 0) {
    lines.push(
      `APROBACIONES PENDIENTES: ${ctx.pendingApprovals
        .map((a) => a.title)
        .join(", ")}`,
    );
  }
  if (ctx.recentToolResults.length > 0) {
    lines.push(
      `RESULTADOS DE HERRAMIENTAS RECIENTES: ${ctx.recentToolResults
        .map((r) => `${r.toolId}: ${r.ok ? "ok" : "error"} — ${r.summary}`)
        .join(" | ")}`,
    );
  }
  if (ctx.departmentMemory.length > 0) {
    lines.push(
      `MEMORIA DEL DEPARTAMENTO: ${ctx.departmentMemory
        .map((m) => `«${m.content}»`)
        .join(", ")}`,
    );
  }
  if (ctx.companyMemory.length > 0) {
    lines.push(
      `MEMORIA DE LA EMPRESA: ${ctx.companyMemory
        .map((m) => `«${m.content}»`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

function humanizeToolId(toolId: string): string {
  return toolId
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function capabilityFor(toolId: string): string | undefined {
  const known: Readonly<Record<string, string>> = {
    mautic: "crm.contacts",
    hubspot: "crm.contacts",
    salesforce: "crm.contacts",
    gmail: "email.send",
    mailchimp: "email.send",
    slack: "messaging.direct",
    notion: "workspace.documents",
  };
  return known[toolId];
}

export type { CapabilityContract };
