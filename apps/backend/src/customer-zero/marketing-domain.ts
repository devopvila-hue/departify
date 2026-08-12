/**
 * Departify Marketing domain model — Sprint ENGINE 03.
 *
 * These are the DEPARTIFY-owned business concepts the CEO sees. Nothing here
 * references OpenClaw, agents, skills, runtimes, or technical session ids.
 * The EngineAdapter boundary stays behind the MarketingService.
 */

export type DepartmentId = "marketing";

export interface DepartmentHeadBusiness {
  readonly departmentId: DepartmentId;
  /** Localized department name (e.g. "Marketing"). */
  readonly department: string;
  readonly name: string;
  readonly role: string;
  readonly initials: string;
}

export interface DigitalEmployee {
  /** Stable id (internal; mapped from a capability/specialist, never shown). */
  readonly id: string;
  /** Business label — what the CEO understands. */
  readonly label: string;
  /** Human role, e.g. "Especialista en Contenido". */
  readonly role: string;
  /** "disponible" | "trabajando" | "bloqueado" | "no_disponible". */
  readonly status: "disponible" | "trabajando" | "bloqueado" | "no_disponible";
  /** What they are doing right now (business language). */
  readonly currentWork?: string;
  /** Underlying capabilities (internal). */
  readonly capabilities: readonly string[];
}

export type BusinessObjectiveStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled";

export interface BusinessObjective {
  readonly id: string;
  readonly departmentId: DepartmentId;
  readonly title: string;
  readonly description: string;
  /** The measurable outcome the CEO wants, e.g. "20 leads cualificados". */
  readonly desiredOutcome: string;
  /** Constraints the CEO stated (budget, channels, exclusions). */
  readonly constraints: readonly string[];
  readonly status: BusinessObjectiveStatus;
  /** 0..100 — real progress reported by the department. */
  readonly progress: number;
  readonly createdAt: string;
  readonly createdBy: "ceo";
  readonly owner: string; // the department head name
  /** Elvira's concrete plan for this objective (business language). */
  readonly plan?: string;
}

export type DepartmentActivityKind =
  | "objetivo_recibido"
  | "plan_creado"
  | "analisis_realizado"
  | "campana_propuesta"
  | "aprobacion_solicitada"
  | "herramienta_utilizada"
  | "resultado_generado"
  | "objetivo_actualizado";

export interface DepartmentActivity {
  readonly id: string;
  readonly departmentId: DepartmentId;
  readonly actor: string; // Elvira / CEO / Marketing
  readonly kind: DepartmentActivityKind;
  readonly message: string; // business language, already localized
  readonly createdAt: string;
  readonly objectiveId?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  readonly id: string;
  readonly departmentId: DepartmentId;
  readonly from: string; // Elvira
  readonly title: string;
  readonly detail: string;
  /** Optional business cost/impact, e.g. "300 €". */
  readonly cost?: string;
  readonly status: ApprovalStatus;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export type ConnectedToolStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "blocked";

export interface ConnectedTool {
  readonly toolId: string;
  readonly label: string;
  /** Business capability, e.g. "Publicidad", "Analítica", "Email". */
  readonly capability: string;
  readonly status: ConnectedToolStatus;
  /** Honest reason when not connected. */
  readonly note?: string;
}

/**
 * Customer Zero hotfix — the DepartmentStatusView status is the truth
 * about the Marketing department's lifecycle. For an organization that
 * has not been provisioned through Customer Zero, the status is
 * `not_provisioned` and `employees` is empty.
 */
export type DepartmentStatus =
  | "not_provisioned"
  | "disponible"
  | "trabajando"
  | "bloqueado"
  | "no_disponible";

export interface DepartmentStatusView {
  readonly id: DepartmentId;
  readonly name: string;
  readonly head: DepartmentHeadBusiness;
  readonly status: DepartmentStatus;
  readonly employees: readonly DigitalEmployee[];
  readonly employeesWorkingNow: number;
  readonly tools: readonly ConnectedTool[];
  readonly toolsConnected: number;
  readonly activeObjective: BusinessObjective | null;
  readonly pendingApprovals: readonly ApprovalRequest[];
  readonly recentActivity: readonly DepartmentActivity[];
  readonly results: readonly { id: string; title: string; summary: string }[];
  readonly activeWork: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: "queued" | "running" | "waiting_approval";
    readonly statusMessage: string;
    readonly progress: number;
    readonly createdAt: string;
    readonly resultId?: string;
  }[];
}

export interface CompanyControlPlaneView {
  readonly companyName: string;
  readonly departments: readonly DepartmentStatusView[];
  readonly departmentsActive: number;
  readonly totalEmployees: number;
  readonly workingNow: number;
  readonly toolsConnected: number;
  readonly pendingApprovals: number;
  readonly activeObjectives: number;
}
