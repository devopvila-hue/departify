import { describe, expect, it } from "vitest";
import { MarketingService } from "../src/customer-zero/marketing-service.js";
import { InMemoryCompanyDnaStore } from "../src/customer-zero/company-dna.js";
import type { DepartmentResult, DepartmentTask } from "../src/customer-zero/department-work.js";
import { buildCompanyOperatingState } from "../src/customer-zero/ceo-overview.js";

const organizationId = "org_marketing_roster";

async function buildService(): Promise<MarketingService> {
  const companyDna = new InMemoryCompanyDnaStore();
  await companyDna.upsert({
    organizationId,
    companyName: "Empresa real",
    description: "Servicio real",
    objective: "Conseguir clientes",
    products: ["Servicio"],
    customers: ["Clientes"],
    channels: ["Web"],
    declaredTools: [],
    uncertainties: [],
    provenance: {},
    factsUpdatedAt: "2026-08-12T00:00:00.000Z",
    departmentProvisionedAt: "2026-08-12T00:00:00.000Z",
  });
  return new MarketingService({
    engine: { sendMessage: async () => ({ status: "completed", text: "" }) } as never,
    companyDna,
  });
}

const activeTask = {
  id: "task_marketing_1",
  organizationId,
  departmentId: "marketing",
  objectiveId: null,
  requestedBy: "ceo",
  assignedEmployeeId: "agent_content_strategist",
  title: "Preparar informe de campaña",
  summary: "Informe de campaña",
  capability: "results.publish",
  toolId: "mautic",
  status: "running",
  statusMessage: "Preparando el informe…",
  progress: 0.5,
  requiredCapabilities: [],
  createdAt: "2026-08-12T10:00:00.000Z",
  startedAt: "2026-08-12T10:01:00.000Z",
  completedAt: null,
  resultId: null,
  errorCode: null,
  errorMessage: null,
  timeoutMs: 60_000,
} as unknown as DepartmentTask;

const result = {
  id: "result_marketing_1",
  organizationId,
  departmentId: "marketing",
  relatedWorkItemId: activeTask.id,
  title: "Informe de campaña",
  summary: "Resultado publicado",
  content: "Resultado real",
  source: "marketing",
  createdAt: "2026-08-12T11:00:00.000Z",
  producedByCapability: "results.publish",
} as unknown as DepartmentResult;

describe("canonical Marketing roster projections", () => {
  it("restores exactly the provisioned template specialists and excludes Elvira", async () => {
    const service = await buildService();
    const employees = await service.getDigitalEmployees(organizationId);

    expect(employees.map((employee) => employee.id)).toEqual([
      "agent_content_strategist",
      "agent_social_media_manager",
      "agent_ads_specialist",
    ]);
    expect(employees.every((employee) => employee.label && employee.role)).toBe(true);
  });

  it("projects durable work, results and verified tools into Marketing", async () => {
    const service = await buildService();
    const status = await service.getDepartmentStatus(
      organizationId,
      [],
      "es",
      {
        tasks: [activeTask],
        results: [result],
        connections: [
          {
            toolId: "mautic",
            label: "Mautic",
            capability: "crm.contacts",
            state: "connected",
          },
        ],
      },
    );

    expect(status.status).toBe("trabajando");
    expect(status.employees).toHaveLength(3);
    expect(status.employeesWorkingNow).toBe(1);
    expect(status.employees.find((employee) => employee.id === "agent_content_strategist")).toMatchObject({
      status: "trabajando",
    });
    expect(status.activeWork.map((task) => task.id)).toEqual([activeTask.id]);
    expect(status.results.map((item) => item.id)).toContain(result.id);
    expect(status.tools).toEqual([
      {
        toolId: "mautic",
        label: "Mautic",
        capability: "crm.contacts",
        status: "connected",
      },
    ]);

    const company = buildCompanyOperatingState({
      base: {
        goal: "Conseguir clientes",
        companyName: "Empresa real",
        heads: [status.head],
        decisions: [],
        activity: [],
        results: [],
        connections: [],
        working: 0,
        done: 0,
      },
      head: status.head,
      tasks: [activeTask],
      results: [result],
      inboxItems: [],
      connections: [],
      dna: null,
      marketing: status,
      marketingApprovals: [],
    });

    expect(company.summary.digitalEmployees).toBe(status.employees.length);
    expect(company.departments[0]?.employees).toHaveLength(status.employees.length);
    expect(company.summary.workingNow).toBe(1);
    expect(company.activity.some((entry) => entry.message.includes(activeTask.title))).toBe(true);
    expect(company.activity.some((entry) => entry.message.startsWith("Especialista en Contenido:"))).toBe(true);
    expect(company.results.some((item) => item.id === result.id)).toBe(true);
  });
});
