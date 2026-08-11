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
export function speakerForIntent(
  intent: string,
  directExternalCapability = false,
): ChatSpeaker {
  if (
    intent === "delegate_marketing" ||
    intent === "explain_work" ||
    intent === "explain_existing_result" ||
    intent === "department_request"
  ) {
    return "elvira";
  }
  // `external_tool_query` is shared by direct Gmail capability reads and
  // department-owned Mautic work. The execution path, not the intent label,
  // decides the identity shown to the CEO.
  if (intent === "external_tool_query" && !directExternalCapability) {
    return "elvira";
  }
  return "departify";
}

/**
 * Build the ordered list of work states for the turn. States are
 * derived from real events — no fabricated steps.
 */
export function workStatesForTurn(input: EnrichmentInput): readonly WorkState[] {
  // Conversational operating system: only emit work-state pills when
  // there is actually work being delegated. A greeting, a meta
  // question, or a help question does NOT need "Mensaje recibido" /
  // "Listo" pills — it needs a normal assistant reply as a bubble.
  // The pills are reserved for real delegation, real tool execution,
  // and real errors so they carry signal.
  if (!input.marketingInvoked) {
    return [];
  }
  const states: WorkState[] = ["delegated", "analyzing"];
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
 * SECURITY: we deliberately do NOT translate to HTML here. The portal's
 * markdown renderer escapes text at its DOM boundary. Keeping plain text
 * here is important for business data such as `Google <no-reply@…>`.
 */
export function normalizeReplyForChat(reply: string): string {
  if (typeof reply !== "string" || reply.length === 0) return reply ?? "";
  // Collapse runs of `*` (engine often emits **bold** literally).
  // Keep the readable text between them.
  const normalized = reply
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\s][^*]*?)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_\s][^_]*?)_/g, "$1");
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
    speaker: speakerForIntent(
      input.intent,
      input.intent === "external_tool_query" && !input.mauticToolUsed,
    ),
    workStates: workStatesForTurn(input),
    normalizedReply: normalizeReplyForChat(input.reply),
  };
}
