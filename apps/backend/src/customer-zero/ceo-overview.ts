/**
 * The CEO's business view — Fases 14-17.
 *
 * Turns the REAL session state (Marketing work items, connections, discovery)
 * into the three surfaces a business owner cares about:
 *
 *   decisiones  → what needs your approval, phrased as a business decision
 *   actividad   → what your company has been doing, in human words
 *   resultados  → what your company has achieved
 *
 * Nothing is invented here: every entry maps to something that really
 * happened in the runtime. Departments that are not implemented produce no
 * entries at all (Fase 19).
 */
import type { CustomerZeroSession } from "./customer-zero-session.js";
import type { CompanyDnaRecord } from "./company-dna.js";
import type { DepartmentStatusView, ApprovalRequest } from "./marketing-domain.js";
import type { DepartmentResult, DepartmentTask } from "./department-work.js";
import type { InboxItem } from "./inbox-domain.js";
import {
  buildHeadView,
  getMarketingHead,
  type DepartmentHeadView,
} from "./department-identity.js";
import { t, type SupportedLocale } from "./locale.js";

export interface DecisionView {
  readonly id: string;
  readonly head: DepartmentHeadView;
  /** What the head proposes, in business language. */
  readonly proposal: string;
  readonly detail: string;
  /** Honest note about what is needed to actually do it, when known. */
  readonly note?: string;
  readonly status: "pending" | "resolved";
}

export interface ActivityView {
  readonly id: string;
  readonly head: DepartmentHeadView;
  readonly message: string;
  readonly tone: "working" | "done" | "waiting" | "blocked";
  readonly createdAt?: string;
}

export interface ResultView {
  readonly id: string;
  readonly head: DepartmentHeadView;
  readonly title: string;
  readonly summary: string;
  readonly createdAt?: string;
}

export interface CeoOverview {
  readonly goal: string;
  readonly companyName: string;
  readonly heads: readonly DepartmentHeadView[];
  readonly decisions: readonly DecisionView[];
  readonly activity: readonly ActivityView[];
  readonly results: readonly ResultView[];
  readonly connections: readonly {
    toolId: string;
    label: string;
    status: string;
    category: string;
  }[];
  readonly working: number;
  readonly done: number;
  readonly team?: {
    readonly director: { readonly name: string; readonly role: string; readonly initials: string };
    readonly specialists: readonly {
      readonly id: string;
      readonly name: string;
      readonly role: string;
      readonly status: string;
    }[];
  };
}

export interface CompanyOperatingState {
  readonly dataStatus: "available" | "partial";
  readonly summary: {
    readonly digitalEmployees: number;
    readonly workingNow: number;
    readonly connectedTools: number;
    readonly pendingApprovals: number;
    readonly activeObjective: { readonly id: string | null; readonly title: string } | null;
  };
  readonly departments: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly head: DepartmentHeadView;
    readonly employees: readonly {
      readonly id: string;
      readonly name: string;
      readonly role: string;
      readonly status: string;
      readonly currentWork?: string;
    }[];
    readonly employeesWorkingNow: number;
    readonly tools: readonly { readonly toolId: string; readonly label: string; readonly capability: string }[];
    readonly toolsConnected: number;
    readonly activeObjective: { readonly id: string | null; readonly title: string; readonly progress?: number } | null;
  }[];
  readonly employees: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly departmentId: string;
    readonly status: string;
    readonly currentWork?: string;
  }[];
  readonly tools: readonly {
    readonly toolId: string;
    readonly label: string;
    readonly capability: string;
    readonly status: "connected";
  }[];
  readonly pendingApprovals: readonly {
    readonly id: string;
    readonly from: string;
    readonly title: string;
    readonly detail: string;
    readonly cost?: string;
    readonly status: "pending";
    readonly createdAt: string;
  }[];
  readonly activity: readonly ActivityView[];
  readonly results: readonly ResultView[];
}

interface OperationalConnectionView {
  readonly toolId: string;
  readonly label: string;
  readonly capability: string;
  readonly state: string;
}

/**
 * Builds the CEO operating cockpit from durable business records. The old
 * session overview remains available for chat compatibility, but this
 * projection deliberately never uses session-local marketing work as proof
 * that something happened.
 */
export function buildCompanyOperatingState(input: {
  readonly base: CeoOverview;
  readonly head: DepartmentHeadView;
  readonly tasks: readonly DepartmentTask[];
  readonly results: readonly DepartmentResult[];
  readonly inboxItems: readonly InboxItem[];
  readonly connections: readonly OperationalConnectionView[];
  readonly dna: CompanyDnaRecord | null;
  readonly marketing: DepartmentStatusView | null;
  readonly marketingApprovals: readonly ApprovalRequest[];
}): CompanyOperatingState {
  const activeTasks = input.tasks.filter((task) =>
    task.status === "queued" || task.status === "running" || task.status === "waiting_approval",
  );
  const connectedTools = input.connections
    .filter((connection) => connection.state === "connected")
    .map((connection) => ({
      toolId: connection.toolId,
      label: connection.label,
      capability: connection.capability,
      status: "connected" as const,
    }));
  const marketingTasks = activeTasks.filter((task) => task.departmentId === "marketing");
  const marketingObjective = input.marketing?.activeObjective
    ? {
        id: input.marketing.activeObjective.id,
        title: input.marketing.activeObjective.title,
        progress: input.marketing.activeObjective.progress,
      }
    : input.dna?.objective
      ? { id: null, title: input.dna.objective }
      : null;
  const activeObjective = marketingObjective
    ? { id: marketingObjective.id, title: marketingObjective.title }
    : null;
  const marketingEmployees = (input.marketing?.employees ?? []).map((employee) => ({
    id: employee.id,
    name: employee.label,
    role: employee.role,
    departmentId: "marketing",
    status: employee.status,
    ...(employee.currentWork ? { currentWork: employee.currentWork } : {}),
  }));
  const marketingTools = (input.marketing?.tools ?? [])
    .filter((tool) => tool.status === "connected")
    .map((tool) => ({ toolId: tool.toolId, label: tool.label, capability: tool.capability }));
  const marketingStatus = marketingTasks.length > 0
    ? marketingTasks.some((task) => task.status === "waiting_approval")
      ? "esperando_aprobacion"
      : "trabajando"
    : input.marketing?.status === "not_provisioned"
      ? "no_disponible"
      : input.marketingApprovals.some((approval) => approval.status === "pending")
        ? "esperando_aprobacion"
        : "disponible";
  const pendingApprovals = input.base.decisions.filter((decision) => decision.status === "pending").length
    + input.marketingApprovals.filter((approval) => approval.status === "pending").length;

  const activity: ActivityView[] = [
    ...input.inboxItems.map((item) => ({
      id: `inbox_${item.id}`,
      head: input.head,
      message: `Correo recibido: ${item.subject}`,
      tone: "done" as const,
      createdAt: item.receivedAt,
    })),
    ...input.tasks.map((task) => ({
      id: `task_${task.id}`,
      head: input.head,
      message: task.source?.type === "inbox_email"
        ? `Correo convertido en tarea: ${task.title}`
        : `Tarea creada: ${task.title}`,
      tone: task.status === "failed"
        ? "blocked" as const
        : task.status === "waiting_approval"
          ? "waiting" as const
          : task.status === "completed"
            ? "done" as const
            : "working" as const,
      createdAt: task.createdAt,
    })),
    ...input.results.map((result) => ({
      id: `result_${result.id}`,
      head: input.head,
      message: `Resultado disponible: ${result.title}`,
      tone: "done" as const,
      createdAt: result.createdAt,
    })),
    ...(input.marketing?.recentActivity ?? []).map((entry) => ({
      id: `marketing_${entry.id}`,
      head: input.head,
      message: entry.message,
      tone: "done" as const,
      createdAt: entry.createdAt,
    })),
  ]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20);

  return {
    dataStatus: "available",
    summary: {
      digitalEmployees: marketingEmployees.length,
      workingNow: activeTasks.length,
      connectedTools: connectedTools.length,
      pendingApprovals,
      activeObjective,
    },
    departments: [{
      id: "marketing",
      name: input.marketing?.name ?? "Marketing",
      status: marketingStatus,
      head: input.head,
      employees: marketingEmployees,
      employeesWorkingNow: marketingTasks.length,
      tools: marketingTools,
      toolsConnected: marketingTools.length,
      activeObjective: marketingObjective,
    }],
    employees: marketingEmployees,
    tools: connectedTools,
    pendingApprovals: input.marketingApprovals
      .filter((approval) => approval.status === "pending")
      .map((approval) => ({
        id: approval.id,
        from: approval.from,
        title: approval.title,
        detail: approval.detail,
        ...(approval.cost ? { cost: approval.cost } : {}),
        status: "pending" as const,
        createdAt: approval.createdAt,
      })),
    activity,
    results: input.results.map((result) => ({
      id: result.id,
      head: input.head,
      title: result.title,
      summary: result.summary,
      createdAt: result.createdAt,
    })),
  };
}

export function buildCeoOverview(session: CustomerZeroSession): CeoOverview {
  const locale: SupportedLocale = session.state.locale;
  const head = buildHeadView(getMarketingHead(), locale);
  const work = session.state.marketingWork;
  const items = work?.items ?? [];

  const decisions: DecisionView[] = items
    .filter(
      (item) =>
        item.status === "needs_approval" ||
        item.status === "approved" ||
        item.status === "unavailable",
    )
    .map((item) => ({
      id: item.id,
      head,
      proposal: t(
        locale,
        `Propone ${lowerFirst(item.title)}.`,
        `Proposes ${lowerFirst(item.title)}.`,
      ),
      detail: item.description,
      ...(item.status === "unavailable" && item.result
        ? { note: item.result }
        : {}),
      status: item.status === "needs_approval" ? ("pending" as const) : ("resolved" as const),
    }));

  const activity: ActivityView[] = items.map((item) => ({
    id: `act_${item.id}`,
    head,
    message: activityMessage(item.title, item.status, head.name, locale),
    tone: activityTone(item.status),
  }));

  if (work) {
    activity.unshift({
      id: "act_plan",
      head,
      message: t(
        locale,
        `${head.name} ha preparado el plan de Marketing para tu objetivo.`,
        `${head.name} prepared the Marketing plan for your goal.`,
      ),
      tone: "done",
    });
  }

  const results: ResultView[] = items
    .filter((item) => item.status === "completed" && item.result)
    .map((item) => ({
      id: `res_${item.id}`,
      head,
      title: item.title,
      summary: item.result ?? "",
    }));

  return {
    goal: session.state.onboarding?.goal ?? work?.goal ?? "",
    companyName: session.state.companyName ?? "",
    heads: [head],
    decisions,
    activity,
    results,
    connections: [...session.state.connections.values()].map((connection) => ({
      toolId: connection.toolId,
      label: connection.label,
      status: connection.status,
      category: connection.category,
    })),
    working: items.filter(
      (item) => item.status === "pending" || item.status === "running",
    ).length,
    done: items.filter((item) => item.status === "completed").length,
    ...(session.state.marketingTeam
      ? {
          team: {
            director: session.state.marketingTeam.director,
            specialists: session.state.marketingTeam.specialists.map((s) => ({
              id: s.id,
              name: s.name,
              role: s.role,
              status: s.status,
            })),
          },
        }
      : {}),
  };
}

function activityMessage(
  title: string,
  status: string,
  name: string,
  locale: SupportedLocale,
): string {
  switch (status) {
    case "completed":
      return t(
        locale,
        `${name} y su equipo han terminado: ${title}.`,
        `${name} and her team finished: ${title}.`,
      );
    case "needs_approval":
      return t(
        locale,
        `${name} necesita tu aprobación para ${lowerFirst(title)}.`,
        `${name} needs your approval to ${lowerFirst(title)}.`,
      );
    case "unavailable":
      return t(
        locale,
        `${name} no puede continuar con ${lowerFirst(title)} hasta conectar la herramienta necesaria.`,
        `${name} cannot continue with ${lowerFirst(title)} until the required tool is connected.`,
      );
    case "failed":
      return t(
        locale,
        `${name} no ha podido completar ${lowerFirst(title)}.`,
        `${name} could not complete ${lowerFirst(title)}.`,
      );
    default:
      return t(
        locale,
        `Marketing está preparando: ${title}.`,
        `Marketing is preparing: ${title}.`,
      );
  }
}

function activityTone(status: string): ActivityView["tone"] {
  switch (status) {
    case "completed":
      return "done";
    case "needs_approval":
      return "waiting";
    case "unavailable":
    case "failed":
      return "blocked";
    default:
      return "working";
  }
}

function lowerFirst(value: string): string {
  return value.length > 0 ? `${value[0]?.toLowerCase()}${value.slice(1)}` : value;
}
