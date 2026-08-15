/**
 * MarketingService — the Departify-owned Marketing department service.
 *
 * ENGINE 03 + DEPLOY 01. This is the ONLY place the backend talks to the
 * engine for Elvira's cognitive work. It composes:
 *
 *   CEO message
 *     → MarketingService (objectives, activity, approvals, employees, tools)
 *     → EngineAdapter.sendMessage (OpenClaw → Vertex) with Elvira context
 *     → business-language reply + activity + approvals
 *
 * DEPLOY 01: durable state. The service depends on Departify-owned repository
 * interfaces (marketing-repositories.ts). Production uses the Supabase
 * implementations; in-memory implementations are for tests/dev only.
 *
 * No OpenClaw types, session keys, or tool ids reach the caller. The engine
 * session is per (organization, department) so multi-turn memory is real and
 * isolated between organizations/companies.
 */

import type { EngineAdapter } from "@departify/engine-adapter";
import type { DepartmentStatus } from "./marketing-domain.js";
import {
  getMarketingHead,
  type DepartmentHead,
} from "./department-identity.js";
import {
  buildBusinessContext,
} from "@departify/tool-catalog";
import type { DiscoveryReportRepository } from "@departify/business-discovery";
import type { CompanyDnaStore } from "./company-dna.js";
import {
  type ApprovalRequest,
  type BusinessObjective,
  type ConnectedTool,
  type DepartmentActivity,
  type DepartmentStatusView,
  type DigitalEmployee,
} from "./marketing-domain.js";
import {
  type MarketingActivityRepository,
  type MarketingApprovalRepository,
  type MarketingObjectiveRepository,
} from "./marketing-repositories.js";
import {
  InMemoryMarketingActivityRepository,
  InMemoryMarketingApprovalRepository,
  InMemoryMarketingObjectiveRepository,
} from "./in-memory-marketing-repositories.js";
import { t, type SupportedLocale } from "./locale.js";
import {
  listReadyCapabilities,
  listAvailableCapabilities,
  type BusinessCapability,
} from "./capability-registry.js";
import { publicCredentialSource } from "./credential-resolver.js";
import {
  compileDepartmentContext,
  renderCompiledContextForEngine,
  compileRuntimeBusinessContext,
  renderRuntimeBusinessContextForEngine,
  type CompiledDepartmentContext,
} from "./department-context-compiler.js";
import { buildRuntimeCapabilityManifest } from "./capability-manifest.js";
import type { CustomerZeroSession } from "./customer-zero-session.js";
import type {
  DepartmentResult,
  DepartmentTask,
  DepartmentWorkStore,
} from "./department-work.js";
import { MARKETING_ROSTER } from "./marketing-roster.js";

export interface MarketingOperationalConnection {
  readonly toolId: string;
  readonly label: string;
  readonly capability: string;
  readonly state: string;
}

export interface MarketingOperationalSnapshot {
  readonly tasks: readonly DepartmentTask[];
  readonly results: readonly DepartmentResult[];
  readonly connections: readonly MarketingOperationalConnection[];
  readonly activity?: readonly DepartmentActivity[];
}

/** Marketing connected tools — honest business labels. */
const MARKETING_TOOLS: readonly Omit<ConnectedTool, "status" | "note">[] = [
  { toolId: "google_ads", label: "Google Ads", capability: "Publicidad" },
  { toolId: "meta_ads", label: "Meta Ads", capability: "Publicidad" },
  { toolId: "meta_business", label: "Meta Business", capability: "Publicación y social" },
  { toolId: "linkedin_ads", label: "LinkedIn Ads", capability: "Publicidad" },
  { toolId: "google_analytics", label: "Google Analytics", capability: "Analítica" },
  { toolId: "hubspot", label: "HubSpot", capability: "CRM" },
  { toolId: "mautic", label: "Mautic", capability: "CRM" },
  { toolId: "gmail", label: "Gmail", capability: "Email" },
  { toolId: "notion", label: "Notion", capability: "Documentos" },
  { toolId: "youtube", label: "YouTube", capability: "Vídeo y distribución" },
  { toolId: "ticktick", label: "TickTick", capability: "Tareas del equipo" },
];

export interface ElviraMessageInput {
  readonly organizationId: string;
  readonly message: string;
  readonly locale: SupportedLocale;
}

export interface ElviraMessageOutput {
  readonly reply: string;
  readonly activity?: readonly DepartmentActivity[];
  readonly approvals?: readonly ApprovalRequest[];
  readonly objective?: BusinessObjective;
}

export interface MarketingServiceOptions {
  readonly engine: EngineAdapter;
  readonly reportRepository?: DiscoveryReportRepository;
  readonly head?: DepartmentHead;
  readonly now?: () => Date;
  /** Durable objective repository (Supabase in production). */
  readonly objectives?: MarketingObjectiveRepository;
  /** Durable activity repository (Supabase in production). */
  readonly activity?: MarketingActivityRepository;
  /** Durable approval repository (Supabase in production). */
  readonly approvals?: MarketingApprovalRepository;
  /** Durable readiness source for the provisioned Marketing roster. */
  readonly companyDna?: CompanyDnaStore;
  /** Durable work source used to project real specialist activity. */
  readonly workStore?: DepartmentWorkStore;
}

/**
 * The Marketing department service. Durable state is owned by the injected
 * repositories; the service never stores objectives/activity/approvals in its
 * own memory (except the engine session id per org, which maps to OpenClaw's
 * persistent session).
 */
export class MarketingService {
  private readonly engine: EngineAdapter;
  private readonly reportRepository: DiscoveryReportRepository | null;
  private readonly head: DepartmentHead;
  private readonly now: () => Date;
  private readonly objectivesRepo: MarketingObjectiveRepository;
  private readonly activityRepo: MarketingActivityRepository;
  private readonly approvalsRepo: MarketingApprovalRepository;
  private readonly companyDna: CompanyDnaStore | null;
  private readonly workStore: DepartmentWorkStore | null;
  /** Engine session id per organization (maps to OpenClaw persistent session). */
  private readonly engineSessionIds = new Map<string, string>();

  constructor(options: MarketingServiceOptions) {
    this.engine = options.engine;
    this.reportRepository = options.reportRepository ?? null;
    this.head = options.head ?? getMarketingHead();
    this.now = options.now ?? (() => new Date());
    this.objectivesRepo =
      options.objectives ?? new InMemoryMarketingObjectiveRepository();
    this.activityRepo =
      options.activity ?? new InMemoryMarketingActivityRepository();
    this.approvalsRepo =
      options.approvals ?? new InMemoryMarketingApprovalRepository();
    this.companyDna = options.companyDna ?? null;
    this.workStore = options.workStore ?? null;
  }

  /* ------------------------- CEO conversation ------------------------- */

  /**
   * The CEO talks to Elvira. This is the Golden Path entry point: the service
   * interprets the message, maintains the objective, calls the engine, records
   * activity, and returns a business-language result.
   */
  async talkToElvira(input: ElviraMessageInput): Promise<ElviraMessageOutput> {
    const active = await this.activeObjective(input.organizationId);

    // 1. Build the context block for Elvira: business DNA + current objective.
    const businessContext = this.reportRepository
      ? buildBusinessContext(input.organizationId, this.reportRepository)
      : null;
    const contextBlock = this.buildElviraContext(
      input.locale,
      businessContext,
      active,
      input.organizationId,
    );

    // 2. Ensure an engine session for (org, marketing) — real multi-turn memory.
    const engineSessionId = await this.ensureEngineSession(input.organizationId);

    // 3. Send the CEO message through the engine (OpenClaw → Vertex).
    const engineMessage = `${contextBlock}\n\n${input.message}`;
    const result = await this.engine.sendMessage({
      sessionId: engineSessionId,
      message: engineMessage,
    });

    const reply = result.text || this.fallbackReply(input.locale);

    // 4. Record activity + generate an approval when appropriate.
    const activity: DepartmentActivity[] = [];
    const approvals: ApprovalRequest[] = [];

    const shouldCreateApproval =
      result.status === "completed" &&
      /(campan[aá]|inversi[oó]n|presupuesto|lanzar|publicidad|campaña)/i.test(
        input.message + " " + reply,
      );

    const receivedActivity = await this.activityRepo.create({
      organizationId: input.organizationId,
      departmentId: "marketing",
      actor: this.head.name,
      type: "objetivo_recibido",
      message: t(
        input.locale,
        `${this.head.name} ha recibido tu mensaje y está trabajando en ello.`,
        `${this.head.name} received your message and is working on it.`,
      ),
    });
    activity.push(receivedActivity);

    if (shouldCreateApproval && active) {
      const extractedCost = this.extractCost(reply);
      const approval = await this.approvalsRepo.create({
        organizationId: input.organizationId,
        departmentId: "marketing",
        ...(active ? { objectiveId: active.id } : {}),
        title: t(
          input.locale,
          `Lanzar una campaña para "${active.title}"`,
          `Launch a campaign for "${active.title}"`,
        ),
        description: reply.slice(0, 400),
        status: "pending",
        ...(extractedCost ? { cost: extractedCost } : {}),
        requestedBy: this.head.name,
      });
      approvals.push(approval);
      const approvalActivity = await this.activityRepo.create({
        organizationId: input.organizationId,
        departmentId: "marketing",
        objectiveId: active.id,
        actor: this.head.name,
        type: "aprobacion_solicitada",
        message: t(
          input.locale,
          `${this.head.name} solicita tu aprobación para ${approval.title.toLowerCase()}.`,
          `${this.head.name} requests your approval to ${approval.title.toLowerCase()}.`,
        ),
      });
      activity.push(approvalActivity);
    }

    return {
      reply,
      activity,
      approvals,
      ...(active ? { objective: active } : {}),
    };
  }

  /* ------------------------- Objectives ------------------------- */

  async createObjective(input: {
    organizationId: string;
    title: string;
    description: string;
    desiredOutcome: string;
    constraints?: readonly string[];
    locale: SupportedLocale;
  }): Promise<BusinessObjective> {
    const objective = await this.objectivesRepo.create({
      organizationId: input.organizationId,
      departmentId: "marketing",
      title: input.title,
      description: input.description,
      desiredOutcome: input.desiredOutcome,
      constraints: [...(input.constraints ?? [])],
      owner: this.head.name,
      createdBy: "ceo",
    });
    await this.activityRepo.create({
      organizationId: input.organizationId,
      departmentId: "marketing",
      objectiveId: objective.id,
      actor: this.head.name,
      type: "objetivo_recibido",
      message: t(
        input.locale,
        `Nuevo objetivo recibido: ${objective.title}.`,
        `New objective received: ${objective.title}.`,
      ),
    });
    return objective;
  }

  async listObjectives(organizationId: string): Promise<BusinessObjective[]> {
    return this.objectivesRepo.list(organizationId, "marketing");
  }

  async getObjective(
    organizationId: string,
    objectiveId: string,
  ): Promise<BusinessObjective | null> {
    return this.objectivesRepo.get(organizationId, objectiveId);
  }

  async addObjectiveConstraint(
    organizationId: string,
    objectiveId: string,
    constraint: string,
    locale: SupportedLocale,
  ): Promise<BusinessObjective | null> {
    const updated = await this.objectivesRepo.addConstraint(
      organizationId,
      objectiveId,
      constraint,
    );
    if (!updated) return null;
    await this.activityRepo.create({
      organizationId,
      departmentId: "marketing",
      objectiveId,
      actor: this.head.name,
      type: "objetivo_actualizado",
      message: t(
        locale,
        `Restricción añadida al objetivo: ${constraint}.`,
        `Constraint added to the objective: ${constraint}.`,
      ),
    });
    return updated;
  }

  async updateObjectiveProgress(
    organizationId: string,
    objectiveId: string,
    progress: number,
    locale: SupportedLocale,
  ): Promise<BusinessObjective | null> {
    const updated = await this.objectivesRepo.updateProgress(
      organizationId,
      objectiveId,
      progress,
    );
    if (!updated) return null;
    await this.activityRepo.create({
      organizationId,
      departmentId: "marketing",
      objectiveId,
      actor: this.head.name,
      type: "objetivo_actualizado",
      message: t(
        locale,
        `Progreso del objetivo actualizado: ${updated.progress}%.`,
        `Objective progress updated: ${updated.progress}%.`,
      ),
    });
    return updated;
  }

  /* ------------------------- Activity ------------------------- */

  async listActivity(organizationId: string): Promise<DepartmentActivity[]> {
    return this.activityRepo.listRecent(organizationId, "marketing", 50);
  }

  async recordActivity(
    organizationId: string,
    entry: Omit<
      DepartmentActivity,
      "id" | "departmentId" | "createdAt" | "actor"
    > & { actor?: string },
  ): Promise<void> {
    await this.activityRepo.create({
      organizationId,
      departmentId: "marketing",
      ...(entry.objectiveId ? { objectiveId: entry.objectiveId } : {}),
      actor: entry.actor ?? this.head.name,
      type: entry.kind,
      message: entry.message,
    });
  }

  /* ------------------------- Approvals ------------------------- */

  async listApprovals(organizationId: string): Promise<ApprovalRequest[]> {
    return this.approvalsRepo.list(organizationId, "marketing");
  }

  async decideApproval(
    organizationId: string,
    approvalId: string,
    decision: "approve" | "reject",
    locale: SupportedLocale,
  ): Promise<ApprovalRequest | null> {
    const updated = await this.approvalsRepo.decide(
      organizationId,
      approvalId,
      decision,
      this.head.name,
    );
    if (!updated) return null;
    await this.activityRepo.create({
      organizationId,
      departmentId: "marketing",
      actor: this.head.name,
      type: decision === "approve" ? "campana_propuesta" : "objetivo_actualizado",
      message: decision === "approve"
        ? t(
            locale,
            `Aprobación concedida: ${updated.title}.`,
            `Approval granted: ${updated.title}.`,
          )
        : t(
            locale,
            `Aprobación rechazada: ${updated.title}.`,
            `Approval rejected: ${updated.title}.`,
          ),
    });
    return updated;
  }

  /* ------------------------- Digital employees + tools ------------------------- */

  async getDigitalEmployees(
    organizationId: string,
    assignedEmployeeIds?: readonly string[],
  ): Promise<DigitalEmployee[]> {
    // Customer Zero hotfix — NEVER return a fake team for an org that has
    // not been provisioned yet. Until the Marketing department exists
    // for this organization, return an empty list. The UI shows
    // "Sin equipo todavía" instead of a seeded 12-person roster.
    const department = await this.findDepartmentForOrg(organizationId);
    if (!department) return [];
    const employeeIds = this.employeeIdsForDepartment(department);
    const objective = await this.activeObjective(organizationId);
    const workingIds = assignedEmployeeIds
      ? new Set(assignedEmployeeIds)
      : await this.workingEmployeeIdsForOrg(organizationId);
    return MARKETING_ROSTER.filter((e) => employeeIds.has(e.id)).map((e) => ({
      ...e,
      status: workingIds.has(e.id) ? "trabajando" : "disponible",
      ...(workingIds.has(e.id) && objective
        ? { currentWork: `Trabajando en "${objective.title}"` }
        : {}),
    }));
  }

  /**
   * Returns the department snapshot for the given organization, if any.
   * Returns null when the Marketing department has not been
   * provisioned through the canonical Customer Zero handoff.
   */
  private async findDepartmentForOrg(organizationId: string): Promise<unknown> {
    // Production reconstructs the provisioned department from durable Company
    // DNA after a restart. The process-local department registry is retained
    // only as a test/dev fallback when no durable store is injected.
    if (this.companyDna) {
      const dna = await this.companyDna.get(organizationId);
      if (dna?.departmentProvisionedAt) {
        return { employees: MARKETING_ROSTER.map((employee) => employee.id) };
      }

      // A native OpenClaw delegation is also a durable provisioning signal.
      // Older/test organizations can have real department tasks without a
      // Company DNA row (for example, before onboarding was persisted). Do
      // not hide that already-provisioned workforce after a restart, while
      // still keeping fresh organizations empty until actual work exists.
      if (this.workStore) {
        const tasks = await this.workStore.listTasksForOrg(organizationId, 100);
        const hasMarketingAssignment = tasks.some(
          (task) =>
            task.departmentId === "marketing" &&
            MARKETING_ROSTER.some(
              (employee) => employee.id === task.assignedEmployeeId,
            ),
        );
        if (hasMarketingAssignment) {
          return { employees: MARKETING_ROSTER.map((employee) => employee.id) };
        }
      }
      return null;
    }
    const session = (await import("./customer-zero-session.js")).getCustomerZeroSession(
      organizationId,
    );
    if (!session) return null;
    const list = session.departmentService.list();
    return (
      list.find(
        (d: { organizationId: string; status: string }) =>
          d.organizationId === organizationId && d.status !== "archived",
      ) ?? null
    );
  }

  private employeeIdsForDepartment(department: { employees?: readonly string[] }): Set<string> {
    const ids = new Set<string>();
    for (const employeeId of department.employees ?? []) {
      ids.add(employeeId);
    }
    return ids;
  }

  async getConnectedTools(
    organizationId: string,
    connectedToolIds: readonly string[] = [],
  ): Promise<ConnectedTool[]> {
    void organizationId;
    const connected = new Set(connectedToolIds);
    return MARKETING_TOOLS.map((tool) => {
      const isConnected = connected.has(tool.toolId);
      return {
        ...tool,
        status: isConnected ? "connected" : "not_connected",
        ...(isConnected
          ? {}
          : { note: "No conectado" }),
      };
    });
  }

  /* ------------------------- Department status ------------------------- */

  async getDepartmentStatus(
    organizationId: string,
    connectedToolIds: readonly string[] = [],
    locale: SupportedLocale,
    operational?: MarketingOperationalSnapshot,
  ): Promise<DepartmentStatusView> {
    const objective = await this.activeObjective(organizationId);
    const approvals = (await this.approvalsRepo.list(organizationId, "marketing"))
      .filter((a) => a.status === "pending");
    const activeWork = (operational?.tasks ?? []).filter(
      (task) =>
        task.organizationId === organizationId &&
        task.departmentId === "marketing" &&
        (task.status === "queued" ||
          task.status === "running" ||
          task.status === "waiting_approval"),
    );
    const assignedEmployeeIds = activeWork.flatMap((task) => {
      const assignment = (task as DepartmentTask & {
        readonly assignedEmployeeId?: string;
      }).assignedEmployeeId;
      return assignment ? [assignment] : [];
    });
    const employees = await this.getDigitalEmployees(
      organizationId,
      assignedEmployeeIds,
    );
    const tools = operational
      ? operational.connections
          .filter(
            (connection) =>
              connection.state === "connected" &&
              connection.capability.trim().length > 0,
          )
          .map((connection) => ({
            toolId: connection.toolId,
            label: connection.label,
            capability: connection.capability,
            status: "connected" as const,
          }))
      : await this.getConnectedTools(organizationId, connectedToolIds);
    const objectives = await this.objectivesRepo.list(organizationId, "marketing");
    const objectiveResults = objectives
      .filter((o) => o.status === "completed")
      .map((o) => ({ id: o.id, title: o.title, summary: o.desiredOutcome }));
    const durableResults = (operational?.results ?? [])
      .filter(
        (result) =>
          result.organizationId === organizationId &&
          result.departmentId === "marketing",
      )
      .map((result) => ({
        id: result.id,
        title: result.title,
        summary: result.summary,
      }));
    const results = [
      ...durableResults,
      ...objectiveResults.filter(
        (result) => !durableResults.some((durable) => durable.id === result.id),
      ),
    ];
    const storedActivity = await this.activityRepo.listRecent(
      organizationId,
      "marketing",
      8,
    );
    const recentActivity = [
      ...(operational?.activity ?? []),
      ...storedActivity,
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    // Customer Zero hotfix — for an organization whose Marketing
    // department has not been provisioned, status is "not_provisioned".
    // The UI renders a "Sin equipo todavía" empty state instead of the
    // pre-hotfix "trabajando" badge with a hard-coded 3-working roster.
    const department = await this.findDepartmentForOrg(organizationId);
    if (!department) {
      return {
        id: "marketing",
        name: t(locale, "Marketing", "Marketing"),
        head: {
          departmentId: "marketing",
          department: t(locale, "Marketing", "Marketing"),
          name: this.head.name,
          role: t(locale, "Directora de Marketing", "Head of Marketing"),
          initials: this.head.initials,
        },
        status: "not_provisioned",
        employees: [],
        employeesWorkingNow: 0,
        tools: [],
        toolsConnected: 0,
        activeObjective: null,
        pendingApprovals: [],
        recentActivity: [],
        results: [],
        activeWork: [],
      };
    }

    const status: DepartmentStatus = activeWork.length > 0
      ? approvals.length > 0
        ? "bloqueado"
        : "trabajando"
      : "disponible";

    return {
      id: "marketing",
      name: t(locale, "Marketing", "Marketing"),
      head: {
        departmentId: "marketing",
        department: t(locale, "Marketing", "Marketing"),
        name: this.head.name,
        role: t(locale, "Directora de Marketing", "Head of Marketing"),
        initials: this.head.initials,
      },
      status,
      employees,
      employeesWorkingNow: employees.filter((e) => e.status === "trabajando").length,
      tools,
      toolsConnected: tools.filter((t) => t.status === "connected").length,
      activeObjective: objective,
      pendingApprovals: approvals,
      recentActivity,
      results: results.slice(0, 4),
      activeWork: activeWork.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status as "queued" | "running" | "waiting_approval",
        statusMessage: task.statusMessage,
        progress: task.progress,
        createdAt: task.createdAt,
        ...(task.resultId ? { resultId: task.resultId } : {}),
      })),
    };
  }

  /* ------------------------- Internals ------------------------- */

  private async activeObjective(
    organizationId: string,
  ): Promise<BusinessObjective | null> {
    return this.objectivesRepo.findActive(organizationId, "marketing");
  }

  private async ensureEngineSession(organizationId: string): Promise<string> {
    const existing = this.engineSessionIds.get(organizationId);
    if (existing) return existing;
    // Deterministic Departify session id per organization+department so the
    // engine keeps real multi-turn context, isolated between companies.
    const sessionId = `marketing:${organizationId}`;
    const session = await this.engine.createSession({ sessionId });
    this.engineSessionIds.set(organizationId, session.id);
    return session.id;
  }

  private buildElviraContext(
    locale: SupportedLocale,
    businessContext: string | null,
    objective: BusinessObjective | null,
    organizationId: string,
  ): string {
    const language = locale === "en" ? "English" : "Spanish (español)";
    const lines: string[] = [
      `Eres Elvira, Directora de Marketing. Responde siempre en ${language}.`,
      "Actúa como una directora de marketing senior: entiende la empresa, diagnostica, identifica información que falta, diseña un plan, selecciona las capacidades necesarias, pide aprobación cuando corresponde e informa de progreso.",
      "NUNCA menciones: que eres una IA, prompts, tokens, agentes, skills, OpenClaw, sesiones técnicas ni arquitectura interna.",
      "No inventes información empresarial: usa SOLO el contexto de negocio y el objetivo que se te proporcionan. Si falta información, pídela.",
    ];

    // Capability surface — what Elvira can actually do today. This is
    // the ONLY capability-aware block in Elvira's system context. She
    // never receives raw credentials, only business-language capability
    // names like "crm.contacts.read" (translated to the active locale).
    const readyCapabilities = listReadyCapabilities(organizationId);
    const unavailable = listAvailableCapabilities(organizationId).filter(
      (c) => !c.available,
    );
    const mauticSource = publicCredentialSource({
      organizationId,
      provider: "mautic",
    });
    lines.push("", "CAPACIDADES DISPONIBLES (capacidades de negocio, no nombres técnicos):");
    if (readyCapabilities.length === 0) {
      lines.push(
        locale === "en"
          ? "- None. If the CEO asks for CRM data, politely say access is missing and offer to connect it."
          : "- Ninguna. Si el CEO pide datos del CRM, explica con educación que falta acceso y ofrece conectarlo.",
      );
    } else {
      const names = readyCapabilities.map((c) => capabilityHumanLabel(c, locale));
      lines.push(`- ${names.join(" · ")}`);
      if (mauticSource.available) {
        lines.push(
          locale === "en"
            ? `- CRM access is configured at the system level. You can use it without asking the CEO for credentials.`
            : `- El acceso al CRM está configurado a nivel de sistema. Puedes usarlo sin pedir credenciales al CEO.`,
        );
      }
    }
    if (unavailable.length > 0) {
      const missing = unavailable
        .filter((c) => c.reason === "credentials_missing")
        .map((c) => capabilityHumanLabel(c.capability, locale));
      if (missing.length > 0) {
        lines.push(
          "",
          locale === "en"
            ? "NOT YET AVAILABLE (would need a connection first):"
            : "AÚN NO DISPONIBLE (requeriría conectar primero):",
          `- ${missing.join(" · ")}`,
        );
      }
    }

    if (businessContext) {
      lines.push("", "CONTEXTO REAL DEL NEGOCIO:", businessContext);
    }
    if (objective) {
      lines.push(
        "",
        "OBJETIVO ACTUAL:",
        `- Título: ${objective.title}`,
        `- Resultado deseado: ${objective.desiredOutcome}`,
        `- Descripción: ${objective.description}`,
        objective.constraints.length > 0
          ? `- Restricciones: ${objective.constraints.join("; ")}`
          : "- Restricciones: ninguna por ahora",
      );
    }
    return lines.join("\n");
  }

  /**
   * Customer Zero 01 — context-aware Elvira conversation.
   *
   * Uses the DepartmentContextCompiler to produce the engine
   * context block. When the session is missing business identity or
   * goal, the compiled context flags the gap explicitly so Elvira
   * can ask for it instead of pretending to know the company.
   */
  async talkToElviraWithSession(input: {
    organizationId: string;
    message: string;
    locale: SupportedLocale;
    session: CustomerZeroSession;
  }): Promise<ElviraMessageOutput> {
    const active = await this.activeObjective(input.organizationId);
    const compiled = compileDepartmentContext(input.session);
    const engineContext = renderCompiledContextForEngine(compiled);
    const [companyDna, runtimeApprovals, runtimeRecentActivity] = await Promise.all([
      this.companyDna?.get(input.organizationId) ?? Promise.resolve(null),
      this.approvalsRepo.list(input.organizationId, "marketing"),
      this.activityRepo.listRecent(input.organizationId, "marketing", 8),
    ]);
    const runtimeConnections = [...input.session.state.connections.values()].map((connection) => ({
      toolId: connection.toolId,
      label: connection.label,
      state: connection.lifecycle ?? connection.status,
      capabilities: connection.grantedCapabilities
        ?? (connection.capability ? [connection.capability] : []),
    }));
    const runtimeCapabilities = buildRuntimeCapabilityManifest(runtimeConnections);
    const runtimeContext = compileRuntimeBusinessContext({
      session: input.session,
      companyDna,
      capabilities: runtimeCapabilities,
      connections: runtimeConnections,
      tasks: [],
      results: [],
      approvals: runtimeApprovals,
      activeObjective: active,
      recentActivity: runtimeRecentActivity,
    });

    const engineSessionId = await this.ensureEngineSession(input.organizationId);
    const engineMessage = `${engineContext}\n\nMENSAJE DEL CEO:\n${input.message}`;
    const result = await this.engine.sendMessage({
      sessionId: engineSessionId,
      message: engineMessage,
      runtimeContext: renderRuntimeBusinessContextForEngine(runtimeContext, "[]"),
    });
    const reply = result.text || this.fallbackReply(input.locale);

    const activity: DepartmentActivity[] = [];
    const approvals: ApprovalRequest[] = [];
    const shouldCreateApproval =
      result.status === "completed" &&
      /(campan[aá]|inversi[oó]n|presupuesto|lanzar|publicidad|campaña)/i.test(
        input.message + " " + reply,
      );

    const receivedActivity = await this.activityRepo.create({
      organizationId: input.organizationId,
      departmentId: "marketing",
      actor: "Elvira",
      type: "objetivo_recibido",
      message: t(
        input.locale,
        `Elvira ha recibido tu mensaje y está trabajando en ello.`,
        `Elvira received your message and is working on it.`,
      ),
    });
    activity.push(receivedActivity);

    if (shouldCreateApproval && active) {
      const extractedCost = this.extractCost(reply);
      const approval = await this.approvalsRepo.create({
        organizationId: input.organizationId,
        departmentId: "marketing",
        ...(active ? { objectiveId: active.id } : {}),
        title: t(
          input.locale,
          `Lanzar una campaña para "${active.title}"`,
          `Launch a campaign for "${active.title}"`,
        ),
        description: reply.slice(0, 400),
        status: "pending",
        ...(extractedCost ? { cost: extractedCost } : {}),
        requestedBy: "Elvira",
      });
      approvals.push(approval);
      const approvalActivity = await this.activityRepo.create({
        organizationId: input.organizationId,
        departmentId: "marketing",
        objectiveId: active.id,
        actor: "Elvira",
        type: "aprobacion_solicitada",
        message: t(
          input.locale,
          `Elvira solicita tu aprobación para ${approval.title.toLowerCase()}.`,
          `Elvira requests your approval to ${approval.title.toLowerCase()}.`,
        ),
      });
      activity.push(approvalActivity);
    }

    return {
      reply,
      activity,
      approvals,
      ...(active ? { objective: active } : {}),
    };
  }

  /** Customer Zero 01 — context readiness check (drives the
   *  progressive-discovery UI). */
  async getContextReadiness(
    session: CustomerZeroSession,
  ): Promise<{
    ready: boolean;
    gaps: readonly string[];
    compiledAt: string;
  }> {
    const compiled = compileDepartmentContext(session);
    return {
      ready: compiled.ready,
      gaps: compiled.gaps,
      compiledAt: compiled.compiledAt,
    };
  }

  /** Customer Zero 01 — returns the compiled department context for
   *  the portal to render (in /inicio and the chat opening). */
  async getCompiledContext(
    session: CustomerZeroSession,
  ): Promise<CompiledDepartmentContext> {
    return compileDepartmentContext(session);
  }

  private fallbackReply(locale: SupportedLocale): string {
    return t(
      locale,
      "He revisado tu mensaje. Cuéntame más sobre lo que quieres conseguir y prepararé el plan de Marketing.",
      "I have reviewed your message. Tell me more about what you want to achieve and I will prepare the Marketing plan.",
    );
  }

  private extractCost(reply: string): string | undefined {
    const match = reply.match(/(\d[\d.,]*)\s*(€|eur|euros|dólares|usd)/i);
    return match ? `${match[1]} €` : undefined;
  }

  private async workingEmployeeIdsForOrg(
    organizationId: string,
  ): Promise<Set<string>> {
    // Customer Zero hotfix — no fake "3 trabajando" badge for a brand-new
    // organization. We only count employees that are actually executing
    // work as tracked in DepartmentTask records. For a fresh org with
    // no in-flight work, this returns the empty set so the UI shows
    // "0 trabajando" — the honest answer.
    const workingIds = new Set<string>();
    if (this.workStore) {
      const tasks = await this.workStore.listTasksForOrg(organizationId, 50);
      for (const task of tasks) {
        if (
          task.departmentId !== "marketing" ||
          (task.status !== "queued" &&
            task.status !== "running" &&
            task.status !== "waiting_approval")
        ) {
          continue;
        }
        if (task.assignedEmployeeId) workingIds.add(task.assignedEmployeeId);
      }
      return workingIds;
    }

    // Dev/test fallback when no durable work store is wired. Activity records
    // intentionally cannot claim an employee is working without actor
    // provenance, so this remains empty rather than inventing a badge.
    return workingIds;
  }

}

/**
 * Human label for a business capability — the only place where the
 * mapping is localized. Elvira's context block consumes this so she
 * talks about capabilities in the CEO's language.
 */
function capabilityHumanLabel(
  capability: string,
  locale: SupportedLocale,
): string {
  const map: Partial<Record<BusinessCapability, { es: string; en: string }>> = {
    "crm.contacts.read": {
      es: "consultar los contactos del CRM",
      en: "consult the CRM contacts",
    },
    "crm.contacts.list": {
      es: "listar contactos del CRM",
      en: "list CRM contacts",
    },
    "crm.contacts.search": {
      es: "buscar contactos del CRM",
      en: "search CRM contacts",
    },
    "crm.contact.read": {
      es: "leer un contacto del CRM",
      en: "read a CRM contact",
    },
    "crm.contacts.summary": {
      es: "resumen de los contactos del CRM",
      en: "summary of the CRM contacts",
    },
    "crm.segments.read": {
      es: "consultar segmentos del CRM",
      en: "consult CRM segments",
    },
    "crm.segments.list": {
      es: "listar segmentos del CRM",
      en: "list CRM segments",
    },
    "crm.campaigns.read": {
      es: "consultar campañas del CRM",
      en: "consult CRM campaigns",
    },
    "crm.campaigns.list": {
      es: "listar campañas del CRM",
      en: "list CRM campaigns",
    },
    "crm.activity.read": {
      es: "consultar la actividad de un contacto",
      en: "consult a contact's activity",
    },
    "results.publish": {
      es: "publicar un resultado del departamento",
      en: "publish a department result",
    },
    "memory.remember": {
      es: "recordar un hecho del departamento",
      en: "remember a department fact",
    },
    "email.identity.read": {
      es: "leer la identidad del buzón",
      en: "read the mailbox identity",
    },
    "email.context.read": {
      es: "leer el contexto del buzón",
      en: "read the mailbox context",
    },
    "email.search": {
      es: "buscar correos reales",
      en: "search real emails",
    },
    "email.thread.read": {
      es: "leer un hilo de correo",
      en: "read an email thread",
    },
    "email.draft": {
      es: "crear un borrador",
      en: "create an email draft",
    },
    "email.send.personal": {
      es: "enviar un correo personal",
      en: "send a personal email",
    },
    "email.send.bulk": {
      es: "enviar una campaña masiva",
      en: "send a bulk email campaign",
    },
    "email.delivery.read": {
      es: "consultar entregas",
      en: "read delivery status",
    },
    "email.bounce.read": {
      es: "consultar rebotes y quejas",
      en: "read bounces and complaints",
    },
    "email.campaign.read": {
      es: "leer una campaña",
      en: "read an email campaign",
    },
    "email.campaign.execute": {
      es: "ejecutar una campaña",
      en: "execute an email campaign",
    },
    "calendar.read": {
      es: "leer el calendario",
      en: "read the calendar",
    },
    "calendar.create": {
      es: "crear un evento en el calendario",
      en: "create a calendar event",
    },
    "calendar.update": {
      es: "actualizar un evento del calendario",
      en: "update a calendar event",
    },
    "drive.search": {
      es: "buscar archivos en Drive",
      en: "search Drive files",
    },
    "drive.read": {
      es: "leer un archivo de Drive",
      en: "read a Drive file",
    },
    "drive.create": {
      es: "crear un archivo en Drive",
      en: "create a Drive file",
    },
    "inbox.read": {
      es: "leer el inbox unificado",
      en: "read the unified inbox",
    },
    "inbox.classify": {
      es: "clasificar un elemento del inbox",
      en: "classify an inbox item",
    },
    "inbox.work.create": {
      es: "crear trabajo desde el inbox",
      en: "create work from inbox",
    },
  };
  const entry = map[capability as BusinessCapability];
  if (!entry) return capability.replace(/^marketing\./, "").replace(/\./g, " ");
  return locale === "en" ? entry.en : entry.es;
}
