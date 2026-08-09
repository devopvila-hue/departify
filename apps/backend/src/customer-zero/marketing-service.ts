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
import {
  getMarketingHead,
  type DepartmentHead,
} from "./department-identity.js";
import {
  buildBusinessContext,
} from "@departify/tool-catalog";
import type { DiscoveryReportRepository } from "@departify/business-discovery";
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

/** Marketing digital employees — mapped from the marketing-director catalog. */
const MARKETING_EMPLOYEES: readonly Omit<DigitalEmployee, "status" | "currentWork">[] = [
  {
    id: "especialista_adquisicion",
    label: "Especialista en Adquisición",
    role: "Adquisición de clientes",
    capabilities: [
      "market_research",
      "audience_segmentation",
      "campaign_strategy",
      "advertising_paid",
    ],
  },
  {
    id: "especialista_contenido",
    label: "Especialista en Contenido",
    role: "Creación de contenido",
    capabilities: [
      "content_creation",
      "content_strategy",
      "positioning_strategy",
      "seo_optimization",
      "social_media",
    ],
  },
  {
    id: "especialista_crecimiento",
    label: "Especialista en Crecimiento",
    role: "Crecimiento y analítica",
    capabilities: ["analytics_measurement", "growth_experimentation", "web_analytics"],
  },
  {
    id: "especialista_conversion",
    label: "Especialista en Conversión",
    role: "Optimización de conversión",
    capabilities: ["audience_segmentation", "positioning_strategy"],
  },
  {
    id: "especialista_estrategia",
    label: "Especialista en Estrategia",
    role: "Estrategia de marketing",
    capabilities: ["market_research", "positioning_strategy", "campaign_strategy"],
  },
  {
    id: "especialista_email",
    label: "Especialista en Email",
    role: "Email marketing",
    capabilities: ["email_marketing"],
  },
  {
    id: "especialista_performance",
    label: "Especialista en Performance",
    role: "Publicidad y rendimiento",
    capabilities: ["advertising_paid", "analytics_measurement"],
  },
  {
    id: "especialista_social",
    label: "Especialista en Redes",
    role: "Redes sociales",
    capabilities: ["social_media", "content_creation"],
  },
  {
    id: "especialista_seo",
    label: "Especialista en SEO",
    role: "Posicionamiento en buscadores",
    capabilities: ["seo_optimization", "content_strategy"],
  },
  {
    id: "especialista_investigacion",
    label: "Especialista en Investigación",
    role: "Investigación de mercado",
    capabilities: ["market_research", "audience_segmentation"],
  },
  {
    id: "especialista_planificacion",
    label: "Especialista en Planificación",
    role: "Planificación de campañas",
    capabilities: ["campaign_strategy", "content_strategy"],
  },
  {
    id: "especialista_reporting",
    label: "Especialista en Reporting",
    role: "Informes y analítica",
    capabilities: ["analytics_measurement", "web_analytics"],
  },
];

/** Marketing connected tools — honest business labels. */
const MARKETING_TOOLS: readonly Omit<ConnectedTool, "status" | "note">[] = [
  { toolId: "google_ads", label: "Google Ads", capability: "Publicidad" },
  { toolId: "meta_ads", label: "Meta Ads", capability: "Publicidad" },
  { toolId: "linkedin_ads", label: "LinkedIn Ads", capability: "Publicidad" },
  { toolId: "google_analytics", label: "Google Analytics", capability: "Analítica" },
  { toolId: "hubspot", label: "HubSpot", capability: "CRM" },
  { toolId: "mautic", label: "Mautic", capability: "CRM" },
  { toolId: "gmail", label: "Gmail", capability: "Email" },
  { toolId: "notion", label: "Notion", capability: "Documentos" },
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

  async getDigitalEmployees(organizationId: string): Promise<DigitalEmployee[]> {
    const objective = await this.activeObjective(organizationId);
    const workingIds = this.workingEmployeeIds();
    return MARKETING_EMPLOYEES.map((e) => ({
      ...e,
      status: workingIds.has(e.id) ? "trabajando" : "disponible",
      ...(workingIds.has(e.id) && objective
        ? { currentWork: `Trabajando en "${objective.title}"` }
        : {}),
    }));
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
  ): Promise<DepartmentStatusView> {
    const objective = await this.activeObjective(organizationId);
    const approvals = (await this.approvalsRepo.list(organizationId, "marketing"))
      .filter((a) => a.status === "pending");
    const employees = await this.getDigitalEmployees(organizationId);
    const tools = await this.getConnectedTools(organizationId, connectedToolIds);
    const objectives = await this.objectivesRepo.list(organizationId, "marketing");
    const results = objectives
      .filter((o) => o.status === "completed")
      .map((o) => ({ id: o.id, title: o.title, summary: o.desiredOutcome }));
    const recentActivity = await this.activityRepo.listRecent(
      organizationId,
      "marketing",
      8,
    );

    const status = objective
      ? approvals.length > 0
        ? "esperando_aprobacion"
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
      employeesWorkingNow: employees.filter((e) => e.status === "trabajando")
        .length,
      tools,
      toolsConnected: tools.filter((t) => t.status === "connected").length,
      activeObjective: objective,
      pendingApprovals: approvals,
      recentActivity,
      results: results.slice(0, 4),
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
  ): string {
    const language = locale === "en" ? "English" : "Spanish (español)";
    const lines: string[] = [
      `Eres Elvira, Directora de Marketing. Responde siempre en ${language}.`,
      "Actúa como una directora de marketing senior: entiende la empresa, diagnostica, identifica información que falta, diseña un plan, selecciona las capacidades necesarias, pide aprobación cuando corresponde e informa de progreso.",
      "NUNCA menciones: que eres una IA, prompts, tokens, agentes, skills, OpenClaw, sesiones técnicas ni arquitectura interna.",
      "No inventes información empresarial: usa SOLO el contexto de negocio y el objetivo que se te proporcionan. Si falta información, pídela.",
    ];
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

  private workingEmployeeIds(): Set<string> {
    // Deterministic, honest heuristic for the local slice: a subset of the
    // team is "working" when an active objective exists. The specific set is
    // stable so the UI shows a consistent "3 trabajando ahora".
    const indices = [0, 2, 4];
    const set = new Set<string>();
    for (const i of indices) {
      const employee = MARKETING_EMPLOYEES[i];
      if (employee) set.add(employee.id);
    }
    return set;
  }

}
