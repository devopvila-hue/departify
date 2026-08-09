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
  message: string;
  /** Optional OpenClaw model override (provider/model). Defaults to agent model. */
  model?: string;
}

export type EngineMessageStatus = "completed" | "failed";

export interface EngineMessageResult {
  sessionId: string;
  messageId?: string;
  text: string;
  status: EngineMessageStatus;
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
