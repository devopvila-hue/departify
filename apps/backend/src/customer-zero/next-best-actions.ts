/**
 * Next Best Actions — Sprint 67 P0.1-B.
 *
 * A SMALL, DETERMINISTIC resolver. The model is never asked to improvise
 * buttons: every action is derived from real state (routing intent,
 * DepartmentResult, approvals, connections) and every action must answer
 * one product question — does this save the entrepreneur from having to
 * think about what to do next?
 *
 * CONTRACTS
 *
 *   - At most 3 actions, compact, only under a reply where they are
 *     genuinely useful. A greeting gets none.
 *   - Internal classification AVAILABLE_NOW / NEEDS_CONNECTION /
 *     NEEDS_APPROVAL. NOT_AVAILABLE never surfaces.
 *   - Clicking an action is EXACTLY the user typing `request` into the
 *     existing chat composer — same command/chat path, one execution,
 *     no parallel pipeline.
 *   - Approval gates are never bypassed: a pending approval surfaces as
 *     NEEDS_APPROVAL ("Revisar aprobación"), never as the action itself.
 */

import type { SupportedLocale } from "./locale.js";
import type { DepartmentResult } from "./department-work.js";
import type { ApprovalRequest } from "./marketing-domain.js";

export type NextBestActionClassification =
  | "AVAILABLE_NOW"
  | "NEEDS_CONNECTION"
  | "NEEDS_APPROVAL";

export interface NextBestAction {
  /** Stable id — the portal uses it for React keys and dedup. */
  readonly id: string;
  /** Compact button label the CEO sees. */
  readonly label: string;
  /** The exact text sent through the EXISTING chat path on click. */
  readonly request: string;
  readonly classification: NextBestActionClassification;
}

export interface NextBestActionsInput {
  readonly locale: SupportedLocale;
  /** Latest routing intent for the turn that produced the reply. */
  readonly intent: string | null;
  /** Recent durable results, NEWEST FIRST (as the store returns them). */
  readonly results: readonly DepartmentResult[];
  readonly approvals: readonly ApprovalRequest[];
  /** Connection projections: toolId/label/status from the session. */
  readonly connections: readonly {
    readonly toolId: string;
    readonly label: string;
    readonly status: string;
  }[];
  /** A connection need the turn itself surfaced (drives "Conectar X"). */
  readonly connectionSuggestion: { toolId: string | null; label: string } | null;
}

const MAX_ACTIONS = 3;

function isConnected(
  connections: readonly { toolId: string; status: string }[],
  toolId: string,
): boolean {
  return connections.some(
    (connection) => connection.toolId === toolId && connection.status === "connected",
  );
}

function es(input: NextBestActionsInput): boolean {
  return input.locale !== "en";
}

/**
 * Resolves the next best actions. Deterministic: same state in, same
 * actions out. Never throws for unknown intents or shapes — an unknown
 * state simply yields fewer (or no) actions.
 */
export function resolveNextBestActions(
  input: NextBestActionsInput,
): readonly NextBestAction[] {
  const spanish = es(input);
  const actions: NextBestAction[] = [];
  const seen = new Set<string>();
  const push = (action: NextBestAction): void => {
    if (actions.length >= MAX_ACTIONS) return;
    if (seen.has(action.id)) return;
    seen.add(action.id);
    actions.push(action);
  };

  const pendingApprovals = input.approvals.filter(
    (approval) => approval.status === "pending",
  );

  // 1 — A pending approval always comes first. It is the one action the
  //     company is genuinely blocked on, and it never bypasses the gate:
  //     the request merely SHOWS the approval for the CEO to decide.
  if (pendingApprovals.length > 0) {
    push(
      spanish
        ? {
            id: "review_approval",
            label: "Revisar aprobación",
            request: "Muéstrame la aprobación pendiente para revisarla.",
            classification: "NEEDS_APPROVAL",
          }
        : {
            id: "review_approval",
            label: "Review approval",
            request: "Show me the pending approval so I can review it.",
            classification: "NEEDS_APPROVAL",
          },
    );
  }

  // 2 — Contextual actions from the NEWEST durable result. Only real
  //     capabilities surface: an action whose tool is not connected is
  //     either replaced by its honest "Conectar X" form or dropped.
  const latest = input.results[0] ?? null;
  if (latest) {
    const isSeoResult =
      latest.departmentId === "seo" ||
      latest.producedByCapability === "seo.audit.website";
    const isMarketingResult = latest.departmentId === "marketing";

    if (isSeoResult) {
      push(
        spanish
          ? {
              id: "seo_fix_priorities",
              label: "Corregir problemas prioritarios",
              request: "Corrige los problemas SEO prioritarios que encontraste en la auditoría.",
              classification: "AVAILABLE_NOW",
            }
          : {
              id: "seo_fix_priorities",
              label: "Fix priority issues",
              request: "Fix the priority SEO issues you found in the audit.",
              classification: "AVAILABLE_NOW",
            },
      );
      push(
        spanish
          ? {
              id: "seo_plan",
              label: "Preparar plan SEO",
              request: "Prepara un plan SEO para mi web.",
              classification: "AVAILABLE_NOW",
            }
          : {
              id: "seo_plan",
              label: "Prepare SEO plan",
              request: "Prepare an SEO plan for my website.",
              classification: "AVAILABLE_NOW",
            },
      );
      // "Revisar repositorio" only exists when a repository is really
      // connected. Without it the action is NOT_AVAILABLE and never shows.
      if (isConnected(input.connections, "github_repository")) {
        push(
          spanish
            ? {
                id: "seo_review_repository",
                label: "Revisar repositorio",
                request: "Revisa el repositorio conectado y dime qué hay que cambiar para el SEO.",
                classification: "AVAILABLE_NOW",
              }
            : {
                id: "seo_review_repository",
                label: "Review repository",
                request: "Review the connected repository and tell me what needs to change for SEO.",
                classification: "AVAILABLE_NOW",
              },
            );
      }
    }

    if (isMarketingResult) {
      push(
        spanish
          ? {
              id: "marketing_to_tasks",
              label: "Convertir estrategia en tareas",
              request: "Convierte esta estrategia de marketing en tareas concretas.",
              classification: "AVAILABLE_NOW",
            }
          : {
              id: "marketing_to_tasks",
              label: "Turn strategy into tasks",
              request: "Turn this marketing strategy into concrete tasks.",
              classification: "AVAILABLE_NOW",
            },
      );
      push(
        spanish
          ? {
              id: "marketing_calendar",
              label: "Preparar calendario",
              request: "Prepara el calendario de publicaciones de marketing.",
              classification: "AVAILABLE_NOW",
            }
          : {
              id: "marketing_calendar",
              label: "Prepare calendar",
              request: "Prepare the marketing publishing calendar.",
              classification: "AVAILABLE_NOW",
            },
      );
      // Publishing needs a real social connection. Without it, the honest
      // action is connecting — never "create the post" against nothing.
      if (isConnected(input.connections, "meta_business")) {
        push(
          spanish
            ? {
                id: "marketing_first_post",
                label: "Crear primera publicación",
                request: "Crea el borrador de la primera publicación para Facebook.",
                classification: "AVAILABLE_NOW",
              }
            : {
                id: "marketing_first_post",
                label: "Create first post",
                request: "Create the draft of the first Facebook publication.",
                classification: "AVAILABLE_NOW",
              },
            );
      } else {
        push(
          spanish
            ? {
                id: "connect_meta",
                label: "Conectar Facebook",
                request: "Quiero conectar Facebook Pages para publicar.",
                classification: "NEEDS_CONNECTION",
              }
            : {
                id: "connect_meta",
                label: "Connect Facebook",
                request: "I want to connect Facebook Pages so you can publish.",
                classification: "NEEDS_CONNECTION",
              },
            );
      }
    }
  }

  // 3 — A connection need the turn itself surfaced (the CEO asked for a
  //     capability whose tool is not connected). The action is connecting
  //     the tool — never pretending to analyze what is not connected.
  if (
    input.connectionSuggestion &&
    !isConnected(input.connections, input.connectionSuggestion.toolId ?? "")
  ) {
    push(
      spanish
        ? {
            id: `connect_${input.connectionSuggestion.toolId ?? "tool"}`,
            label: `Conectar ${input.connectionSuggestion.label}`,
            request: `Quiero conectar ${input.connectionSuggestion.label}.`,
            classification: "NEEDS_CONNECTION",
          }
        : {
            id: `connect_${input.connectionSuggestion.toolId ?? "tool"}`,
            label: `Connect ${input.connectionSuggestion.label}`,
            request: `I want to connect ${input.connectionSuggestion.label}.`,
            classification: "NEEDS_CONNECTION",
          },
    );
  }

  // N7 — a plain conversational turn (greeting, direct response with no
  // durable work, no approvals, no connection need) naturally yields NO
  // actions here: nothing pushed above. Generic filler ("Explorar más",
  // "Seguir trabajando") is never generated.
  return actions.slice(0, MAX_ACTIONS);
}
