/**
 * Provider-independent engine types.
 *
 * These are the ONLY engine shapes Departify business code may see. Nothing
 * OpenClaw-specific (session keys, run ids, event types, gateway frames) may
 * leak past the `OpenClawEngineAdapter` boundary.
 */

export type EngineSessionStatus = "active" | "closed" | "error";

export interface EngineSession {
  /** Canonical Departify session id. */
  id: string;
  status: EngineSessionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface EngineSendMessageInput {
  sessionId: string;
  /** Optional native agent identity for internal workforce sessions. */
  agentId?: string;
  message: string;
  /** Optional server-side timing sink. Stage metadata must remain
   * non-sensitive (no prompt, response, credentials or token values). */
  timeline?: (stage: string, metadata?: Readonly<Record<string, unknown>>) => void;
  /** Optional OpenClaw model override (provider/model). Defaults to agent model. */
  model?: string;
  /** Safe, structured runtime context rendered by the provider adapter. */
  runtimeContext?: string;
  /** Normalized Departify business tools available for this turn. */
  businessTools?: readonly EngineBusinessToolDefinition[];
  /** Structured result from a backend-authorized business tool call. */
  toolResult?: string;
  /** Experimental native OpenClaw mode; no textual Departify tool protocol. */
  nativeBusinessTools?: boolean;
  /**
   * Sprint 67 P0 — progressive assistant text delivery.
   *
   * The provider adapter invokes this callback for every user-visible
   * assistant text delta the gateway emits while the run is in flight.
   * The callback is invoked from the WebSocket message loop. Implementations
   * MUST be non-blocking and free of side effects on the canonical message
   * store. The final `result` returned by `sendMessage` still carries the
   * authoritative final text — the chunks are a transport concern, not a
   * second source of truth.
   *
   * `finished` is the structural run-settled signal: the gateway has
   * emitted the terminal event for the run (e.g. lifecycle status
   * completed/ok on agent.wait). The chat history is stable at this point.
   */
  onChunk?: (chunk: EngineAssistantChunk) => void;
}

/** A single assistant text delta from the model. Provider-neutral. */
export interface EngineAssistantChunk {
  /** UTF-8 text delta. The portal concatenates these in order. */
  text: string;
  /** True if this is the final chunk emitted before run settlement. */
  finished: boolean;
}

export interface EngineNativeToolPolicyInput {
  sessionId: string;
  toolNames: readonly string[];
  /** Defaults to the CEO/main agent. */
  agentId?: string;
}

/** Provider-neutral business tool metadata. Never contains credentials. */
export interface EngineBusinessToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly requiredCapability?: string;
  readonly sideEffect: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export type EngineMessageStatus = "completed" | "failed";

export interface EngineMessageResult {
  sessionId: string;
  messageId?: string;
  text: string;
  status: EngineMessageStatus;
  /**
   * OpenClaw produced a durable final assistant message, but a later run
   * status/event was non-success. The text is still authoritative and must
   * not be replaced by a generic generation error.
   */
  postGenerationFailure?: boolean;
  usage?: EngineUsage;
  toolCalls?: EngineToolCall[];
  durationMs?: number;
  errorCode?: string;
}

export interface EngineUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  cacheReadTokens?: number;
  model?: string;
  provider?: string;
  durationMs?: number;
}

export type EngineToolCallStatus = "started" | "completed" | "failed";

export interface EngineToolCall {
  id?: string;
  name: string;
  status: EngineToolCallStatus;
  durationMs?: number;
}

export interface EngineToolState {
  /** Tools/capabilities technically available for the session's agent. */
  available: string[];
  /** Tools/capabilities explicitly denied by policy. */
  denied: string[];
}

export type EngineHistoryRole = "user" | "assistant" | "system" | "tool";

export interface EngineHistoryItem {
  role: EngineHistoryRole;
  text?: string;
  createdAt?: string;
  toolName?: string;
}

export interface EngineHistory {
  sessionId: string;
  items: EngineHistoryItem[];
}

export interface EngineHealth {
  /** Process alive. */
  healthy: boolean;
  /** Engine capable of accepting work (readiness). */
  ready: boolean;
  provider?: string;
  model?: string;
}
