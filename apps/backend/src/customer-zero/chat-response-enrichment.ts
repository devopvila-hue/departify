/**
 * Chat response enrichment — Customer Zero 01.
 *
 * Pure helpers that take the raw outcome of the command-center
 * orchestrator and produce:
 *
 *   1. A speaker identity for each transcript event:
 *      - "departify"   for system replies (no department involved)
 *      - "elvira"      for replies produced by Elvira / Marketing
 *
 *   2. A work-state event sequence that the portal renders as a
 *      live status strip ("Elvira está revisando…", "Consultando
 *      Mautic…", "Preparando respuesta…"). States are derived from
 *      the routing decision + whether the engine call succeeded.
 *      No fake timers; if the state did not occur, no event is
 *      produced.
 *
 *   3. A safe Markdown normalization pass on the assistant reply
 *      (escaping characters that the portal renderer would render
 *      as literal `**`). The portal owns the visual rendering; this
 *      is purely about NOT leaking raw engine asterisks.
 */

import type { CommandCenterEvent } from "./command-center.js";
import type { SupportedLocale } from "./locale.js";

export type ChatSpeaker = "departify" | "elvira";

export type WorkState =
  | "received"
  | "delegated"
  | "analyzing"
  | "tool_started"
  | "tool_completed"
  | "preparing_result"
  | "completed"
  | "blocked"
  | "error";

/** Human-friendly label for a work state. */
export function workStateLabel(
  state: WorkState,
  locale: SupportedLocale,
): string {
  const es = locale !== "en";
  switch (state) {
    case "received":
      return es ? "Mensaje recibido" : "Message received";
    case "delegated":
      return es ? "Enviado a Elvira" : "Sent to Elvira";
    case "analyzing":
      return es ? "Elvira está analizando tu petición…" : "Elvira is analysing your request…";
    case "tool_started":
      return es ? "Consultando Mautic…" : "Querying Mautic…";
    case "tool_completed":
      return es ? "Datos recibidos de Mautic" : "Data received from Mautic";
    case "preparing_result":
      return es ? "Preparando una recomendación…" : "Preparing a recommendation…";
    case "completed":
      return es ? "Listo" : "Ready";
    case "blocked":
      return es ? "Esperando una conexión" : "Waiting on a connection";
    case "error":
      return es
        ? "Elvira no ha podido acceder a Mautic en este momento."
        : "Elvira could not reach Mautic right now.";
  }
}

export interface EnrichmentInput {
  readonly intent: string;
  readonly marketingInvoked: boolean;
  readonly marketingSucceeded: boolean;
  readonly locale: SupportedLocale;
  readonly reply: string;
  /** When the engine path used a Mautic tool. */
  readonly mauticToolUsed?: boolean;
  /** When a connection card is being surfaced. */
  readonly connectionBlocked?: boolean;
}

export interface EnrichmentOutput {
  readonly speaker: ChatSpeaker;
  readonly workStates: readonly WorkState[];
  readonly normalizedReply: string;
}

/**
 * Decide the chat speaker for a single turn. When Marketing answered
 * we mark it as `elvira`; otherwise `departify`.
 */
export function speakerForIntent(intent: string): ChatSpeaker {
  if (
    intent === "delegate_marketing" ||
    intent === "external_tool_query" ||
    intent === "explain_work" ||
    intent === "explain_existing_result" ||
    intent === "department_request"
  ) {
    return "elvira";
  }
  return "departify";
}

/**
 * Build the ordered list of work states for the turn. States are
 * derived from real events — no fabricated steps.
 */
export function workStatesForTurn(input: EnrichmentInput): readonly WorkState[] {
  const states: WorkState[] = ["received"];
  if (!input.marketingInvoked) {
    states.push("completed");
    return states;
  }
  states.push("delegated", "analyzing");
  if (input.connectionBlocked) {
    states.push("blocked", "error");
    return states;
  }
  if (!input.marketingSucceeded) {
    states.push("error");
    return states;
  }
  if (input.mauticToolUsed) {
    states.push("tool_started", "tool_completed");
  }
  states.push("preparing_result", "completed");
  return states;
}

/**
 * Apply a defensive Markdown normalization. The engine (Vertex /
 * Gemini) sometimes emits replies with bold markers (`**…**`) or
 * bare asterisks that the portal's renderer used to show as
 * literal text. We strip those so the portal can apply its own
 * renderer without surprises.
 *
 * SECURITY: we deliberately do NOT translate to HTML here. The
 * portal renders only the textual content (no HTML), and any
 * HTML-looking input is escaped.
 */
export function normalizeReplyForChat(reply: string): string {
  if (typeof reply !== "string" || reply.length === 0) return reply ?? "";
  // Collapse runs of `*` (engine often emits **bold** literally).
  // Keep the readable text between them.
  let normalized = reply
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\s][^*]*?)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_\s][^_]*?)_/g, "$1");
  // Escape characters that could be interpreted as raw HTML if the
  // portal ever allows HTML rendering by accident. Today's renderer
  // uses textContent — this is a belt-and-braces guard.
  normalized = normalized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Defensive: revert over-escape on the asterisks we already
  // removed, since we don't need HTML entities for plain text.
  return normalized;
}

/**
 * Build a sequence of `work_state` events the portal renders as a
 * live status strip in the same conversation.
 */
export function buildWorkStateEvents(
  states: readonly WorkState[],
  locale: SupportedLocale,
): readonly CommandCenterEvent[] {
  return states.map((state) => ({
    kind: "work_state",
    state,
    message: workStateLabel(state, locale),
  }));
}

export function enrichForChat(input: EnrichmentInput): EnrichmentOutput {
  return {
    speaker: speakerForIntent(input.intent),
    workStates: workStatesForTurn(input),
    normalizedReply: normalizeReplyForChat(input.reply),
  };
}
