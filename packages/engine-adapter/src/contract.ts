import type {
  EngineHealth,
  EngineHistory,
  EngineNativeToolPolicyInput,
  EngineMessageResult,
  EngineSendMessageInput,
  EngineSession,
  EngineToolState,
  EngineUsage,
} from "./types.js";

/**
 * The stable, provider-independent engine boundary owned by Departify.
 *
 * Business code (handlers, domains, departments) depends only on this
 * interface and on the types in `./types.ts`. Swapping OpenClaw for another
 * engine must not require touching callers.
 */
export interface EngineAdapter {
  /**
   * Create or initialise a real engine session. Returns a Departify-owned
   * session id; the engine keeps its own internal mapping.
   */
  createSession(input?: {
    sessionId?: string;
    model?: string;
    /** Native OpenClaw agent identity for internal workforce sessions. */
    agentId?: string;
  }): Promise<EngineSession>;

  /**
   * Send a message through the engine and wait for the terminal reply.
   */
  sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult>;

  /** Publish the backend-authorized native read surface for this session. */
  setNativeToolPolicy?(input: EngineNativeToolPolicyInput): Promise<void>;

  /**
   * Read a session's normalized state. Returns null when the session does not
   * exist.
   */
  getSession(sessionId: string, agentId?: string): Promise<EngineSession | null>;

  /**
   * Read the normalized conversation history of a session.
   */
  getHistory(sessionId: string): Promise<EngineHistory>;

  /**
   * Close a session using the engine's native close semantics. History is
   * preserved (archived) by default.
   */
  closeSession(sessionId: string): Promise<void>;

  /**
   * Read token/usage data for a session when the engine exposes it.
   */
  getUsage(sessionId: string): Promise<EngineUsage>;

  /**
   * Read the effective technical tool policy for a session's agent.
   */
  getToolState(sessionId: string): Promise<EngineToolState>;

  /**
   * Liveness + readiness. Distinguishes "process alive" from "can accept work".
   */
  health(): Promise<EngineHealth>;
}
