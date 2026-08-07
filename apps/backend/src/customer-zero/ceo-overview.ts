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
}

export interface ResultView {
  readonly id: string;
  readonly head: DepartmentHeadView;
  readonly title: string;
  readonly summary: string;
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
