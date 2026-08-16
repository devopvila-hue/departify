import { describe, expect, it } from "vitest";
import { buildCompanyOperatingState, type CeoOverview } from "../src/customer-zero/ceo-overview.js";
import { buildHeadView, getMarketingHead } from "../src/customer-zero/department-identity.js";
import type { DepartmentTask, DepartmentResult } from "../src/customer-zero/department-work.js";
import type { InboxItem } from "../src/customer-zero/inbox-domain.js";
import { departmentCapabilityDefinitions } from "../src/customer-zero/department-capabilities.js";

const head = buildHeadView(getMarketingHead(), "es");
const base = {
  goal: "Conseguir clientes",
  companyName: "Ejemplo",
  heads: [head],
  decisions: [],
  activity: [],
  results: [],
  connections: [],
  working: 0,
  done: 0,
} satisfies CeoOverview;

const task = {
  id: "task_1",
  organizationId: "org_1",
  departmentId: "marketing",
  objectiveId: null,
  requestedBy: "ceo",
  title: "Revisar: Presupuesto agosto",
  summary: "Correo convertido en tarea",
  capability: "results.publish",
  toolId: "inbox",
  status: "running",
  statusMessage: "En curso",
  progress: 0.2,
  requiredCapabilities: [],
  createdAt: "2026-08-12T10:00:00.000Z",
  startedAt: "2026-08-12T10:00:00.000Z",
  completedAt: null,
  resultId: null,
  errorCode: null,
  errorMessage: null,
  timeoutMs: 60_000,
  source: {
    type: "inbox_email",
    inboxItemId: "inbox_1",
    provider: "hostinger",
    providerMessageId: "uid-1",
  },
} as unknown as DepartmentTask;

const inbox = {
  id: "inbox_1",
  organizationId: "org_1",
  source: "hostinger",
  sourceMessageId: "uid-1",
  channel: "email",
  category: "administrative",
  subject: "Presupuesto agosto",
  sender: { email: "alex@example.com" },
  recipients: [{ email: "empresa@example.com" }],
  plainText: "Contenido privado no debe entrar en la actividad.",
  preview: "Contenido privado",
  receivedAt: "2026-08-12T09:55:00.000Z",
  unread: true,
  importance: 0.4,
  departmentId: "marketing",
  isLead: false,
  relatedWorkItemId: "task_1",
  relatedConversationId: null,
  provenance: { provider: "hostinger", providerMessageUid: "uid-1" },
  state: "in_work",
  createdAt: "2026-08-12T09:55:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
} as unknown as InboxItem;

describe("company operating state projection", () => {
  it("reconciles connected tools, active durable work and Inbox activity", () => {
    const result = buildCompanyOperatingState({
      base,
      head,
      tasks: [task],
      results: [],
      inboxItems: [inbox],
      connections: [
        { toolId: "hostinger_email", label: "Correo empresarial", capability: "email.read", state: "connected" },
        { toolId: "mautic", label: "Mautic", capability: "crm.contacts.read", state: "needs_connection" },
      ],
      dna: null,
      marketing: null,
      marketingApprovals: [],
    });

    expect(result.summary.connectedTools).toBe(1);
    expect(result.summary.workingNow).toBe(1);
    expect(result.departments[0]?.employeesWorkingNow).toBe(1);
    expect(result.activity.map((entry) => entry.message)).toEqual([
      "Correo convertido en tarea: Revisar: Presupuesto agosto",
      "Correo recibido: Presupuesto agosto",
    ]);
    expect(result.activity.join(" ")).not.toContain("Contenido privado");
  });

  it("counts only pending approvals and exposes real results", () => {
    const result: DepartmentResult = {
      id: "result_1",
      organizationId: "org_1",
      departmentId: "marketing",
      relatedWorkItemId: null,
      title: "Informe de campaña",
      summary: "Resultado real",
      content: "Contenido del resultado",
      source: "marketing",
      createdAt: "2026-08-12T11:00:00.000Z",
      producedByCapability: "results.publish",
    };
    const projected = buildCompanyOperatingState({
      base: { ...base, decisions: [{ id: "d1", head, proposal: "x", detail: "x", status: "pending" }] },
      head,
      tasks: [],
      results: [result],
      inboxItems: [],
      connections: [],
      dna: { organizationId: "org_1", companyName: "Ejemplo", objective: "Vender", products: [], customers: [], channels: [], declaredTools: [], uncertainties: [], provenance: {}, factsUpdatedAt: "2026-08-12T00:00:00.000Z" },
      marketing: null,
      marketingApprovals: [{ id: "a1", departmentId: "marketing", from: "Elvira", title: "Aprobar", detail: "x", status: "pending", createdAt: "2026-08-12T10:00:00.000Z" }],
    });

    expect(projected.summary.pendingApprovals).toBe(2);
    expect(projected.summary.activeObjective?.title).toBe("Vender");
    expect(projected.results[0]?.title).toBe("Informe de campaña");
  });

  it("does not invent employees or tools when canonical state is empty", () => {
    const result = buildCompanyOperatingState({
      base,
      head,
      tasks: [],
      results: [],
      inboxItems: [],
      connections: [],
      dna: null,
      marketing: null,
      marketingApprovals: [],
    });
    expect(result.summary.digitalEmployees).toBe(0);
    expect(result.summary.connectedTools).toBe(0);
    expect(result.employees).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.activity).toEqual([]);
  });

  it("uses the same canonical capability roster for department and company counts", () => {
    const marketingCapabilities = departmentCapabilityDefinitions("marketing").map((entry) => ({
      ...entry,
      state: "disponible" as const,
    }));
    const seoCapabilities = departmentCapabilityDefinitions("seo").map((entry) => ({
      ...entry,
      state: "necesita_conexion" as const,
    }));
    const result = buildCompanyOperatingState({
      base,
      head,
      tasks: [],
      results: [],
      inboxItems: [],
      connections: [],
      dna: null,
      marketing: {
        id: "marketing",
        name: "Marketing",
        head: { departmentId: "marketing", department: "Marketing", name: "Elvira", role: "Jefa de Marketing", initials: "E" },
        status: "disponible",
        employees: [],
        employeesWorkingNow: 0,
        capabilities: marketingCapabilities,
        tools: [],
        toolsConnected: 0,
        activeObjective: null,
        pendingApprovals: [],
        recentActivity: [],
        results: [],
        activeWork: [],
      },
      marketingApprovals: [],
      seo: { website: null, capabilities: seoCapabilities, tasks: [], results: [] },
    });

    expect(result.departments.find((department) => department.id === "marketing")?.capabilities.length)
      .toBe(marketingCapabilities.length);
    expect(result.departments.find((department) => department.id === "seo")?.capabilities.length)
      .toBe(seoCapabilities.length);
    expect(result.summary.operationalCapabilities)
      .toBe(marketingCapabilities.length + seoCapabilities.length);
  });
});
