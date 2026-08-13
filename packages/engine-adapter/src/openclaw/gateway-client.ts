/**
 * OpenClawGatewayClient — the ONLY technical layer that talks to the OpenClaw
 * Gateway WebSocket protocol (v4). Everything OpenClaw-specific lives here.
 *
 * Verified against OpenClaw v2026.7.1-2 (Sprint ENGINE 01 runtime).
 *
 * Responsibilities:
 * - WebSocket connect + auth (shared token + optional device identity)
 * - JSON-RPC framing (req/res/event)
 * - per-request timeouts and pending-map cleanup
 * - graceful close, bounded reconnect with backoff
 * - mapping gateway `res.error` into our EngineError taxonomy
 *
 * It does NOT know about Departify sessions, history mapping, or tool policy.
 */

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  EngineAuthenticationError,
  EngineError,
  EngineInvalidRequestError,
  EngineProtocolError,
  EngineRateLimitError,
  EngineSessionNotFoundError,
  EngineTimeoutError,
  EngineUnavailableError,
  type EngineErrorCode,
} from "../errors.js";

const PROTOCOL_VERSION = 4;
const AGENT_DEFAULT = "main";

const OPERATOR_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
];

type ReqParams = Record<string, unknown>;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export interface GatewayClientOptions {
  url: string;
  token?: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  retryLimit: number;
  maxRetryDelayMs: number;
  /** Optional persisted device key (PEM) for gateway device auth. */
  deviceKeyPem?: string;
}

export interface GatewayFrameError {
  code?: string;
  message?: string;
  details?: { code?: string; reason?: string; requestId?: string } | null;
  retryable?: boolean;
  retryAfterMs?: number;
}

/** Normalized gateway RPC error before mapping. */
export interface GatewayRpcError extends Error {
  gatewayCode?: string;
  gatewayDetails?: GatewayFrameError["details"];
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface AgentEvent {
  runId?: string;
  sessionKey?: string;
  stream?: string;
  data?: Record<string, unknown>;
  status?: string;
}

export interface RunResult {
  runId: string;
  status: string;
  endedAt?: number;
}

export interface RunEvents {
  assistantChunks?: string[];
  toolCalls?: Array<{ name: string; status: string }>;
  lifecycleError?: string;
}

export type GatewayTimeline = (
  stage: string,
  metadata?: Readonly<Record<string, unknown>>,
) => void;

/**
 * Maps a gateway frame error into a provider-independent EngineError.
 * Central place where OpenClaw/Vertex error codes become Departify errors.
 */
export function mapGatewayError(
  err: GatewayRpcError,
  operation?: string,
): EngineError {
  const code = err.gatewayCode ?? err.message;
  const details = err.gatewayDetails;
  const statusCode = typeof details?.code === "string" ? undefined : undefined;
  void statusCode;
  const provider = "openclaw";
  const opts = {
    cause: err,
    provider,
    ...(operation ? { operation } : {}),
    ...(err.retryable !== undefined ? { retryable: err.retryable } : {}),
    ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
  };

  if (/429|resource exhausted|rate limit|quota/i.test(code ?? "")) {
    return new EngineRateLimitError(`Engine rate limit: ${err.message}`, opts);
  }
  if (/401|unauthorized|403|forbidden/i.test(code ?? "")) {
    return new EngineAuthenticationError(`Engine authentication failed: ${err.message}`, opts);
  }
  if (/NOT_PAIRED|PAIRING_REQUIRED|DEVICE_/i.test(code ?? "")) {
    return new EngineAuthenticationError(`Engine device not paired: ${err.message}`, opts);
  }
  if (/not found|SESSION_NOT_FOUND|session.*not found/i.test(code ?? "")) {
    return new EngineSessionNotFoundError(`Session not found: ${err.message}`, opts);
  }
  if (/INVALID_REQUEST|MISSING_SCOPE/i.test(code ?? "")) {
    return new EngineInvalidRequestError(`Engine rejected request: ${err.message}`, opts);
  }
  if (/timeout|timed out/i.test(code ?? "")) {
    return new EngineTimeoutError(`Engine request timed out: ${err.message}`, opts);
  }
  if (/UNAVAILABLE|ECONNREFUSED|ECONNRESET|socket hang up|closed/i.test(code ?? "")) {
    return new EngineUnavailableError(`Engine unavailable: ${err.message}`, opts);
  }
  return new EngineProtocolError(`Engine protocol error: ${err.message}`, opts);
}

export class OpenClawGatewayClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<string, PendingRequest>();
  private nonce: string | null = null;
  private challengeTs = 0;
  private closedByUs = false;
  private readonly opts: GatewayClientOptions;

  constructor(opts: GatewayClientOptions) {
    this.opts = opts;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Opens a connection and authenticates. Returns when hello-ok is received.
   * Rejects with an EngineError on auth/connect failure.
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;
    // Each connection has a fresh server challenge. Never reuse the previous
    // connection's nonce/timestamp: after a gateway restart the old
    // timestamp is stale and the device signature is rejected
    // (DEVICE_AUTH_SIGNATURE_EXPIRED). Reset so waitForChallenge below waits
    // for the new challenge.
    this.nonce = null;
    this.challengeTs = 0;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    this.closedByUs = false;

    // Attach handlers BEFORE awaiting open so the `connect.challenge` that the
    // gateway sends immediately after open is never missed.
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    ws.onclose = () => {
      this.failPending(
        new EngineUnavailableError("Gateway connection closed", {
          operation: "transport",
          provider: "openclaw",
          retryable: true,
        }),
      );
      if (this.ws === ws) this.ws = null;
    };
    ws.onerror = () => {
      this.failPending(
        new EngineUnavailableError("Gateway connection error", {
          operation: "transport",
          provider: "openclaw",
          retryable: true,
        }),
      );
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new EngineTimeoutError("Gateway connection timed out", {
            operation: "connect",
            provider: "openclaw",
          }),
        );
        ws.close();
      }, this.opts.connectTimeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(
          new EngineUnavailableError("Gateway connection failed", {
            operation: "connect",
            provider: "openclaw",
            retryable: true,
          }),
        );
      };
    });

    // Wait for connect.challenge (buffered by handleMessage).
    await this.waitForChallenge(this.opts.connectTimeoutMs);

    // Build connect params with optional device identity.
    const connectParams: ReqParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: "gateway-client",
        version: "engine-02",
        platform: "server",
        mode: "backend",
      },
      role: "operator",
      scopes: OPERATOR_SCOPES,
      caps: ["tool-events"],
      commands: [],
      permissions: {},
      ...(this.opts.token ? { auth: { token: this.opts.token } } : {}),
      locale: "en-US",
      userAgent: "departify-backend/engine-02",
    };

    if (this.opts.deviceKeyPem && this.nonce) {
      connectParams.device = this.buildDeviceAuth(this.opts.deviceKeyPem);
    }

    // Send connect directly (bypass ensureConnected to avoid recursion).
    await this.requestOnce("connect", connectParams);
  }

  /** Disconnect cleanly. Safe to call when not connected. */
  close(): void {
    this.closedByUs = true;
    if (this.ws) {
      try {
        this.ws.close(1000, "departify-complete");
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  /**
   * Perform an RPC request. Retries transient failures with bounded backoff.
   */
  async request(method: string, params: ReqParams = {}): Promise<unknown> {
    const operation = method;
    let attempt = 0;
    for (;;) {
      try {
        await this.ensureConnected();
        return await this.requestOnce(method, params);
      } catch (err) {
        const mapped = this.mapToEngineError(err, operation);
        // An explicit `retryable:false` on the mapped error always wins
        // (e.g. a rate-limit error marked non-retryable).
        if (mapped.retryable === false) {
          throw mapped;
        }
        const retryable =
          mapped instanceof EngineUnavailableError ||
          mapped instanceof EngineRateLimitError ||
          (mapped instanceof EngineTimeoutError && method !== "agent.wait") ||
          (mapped instanceof EngineProtocolError &&
            /closed|refused|reset|hang up/i.test(mapped.message));
        if (!retryable || attempt >= this.opts.retryLimit) {
          throw mapped;
        }
        attempt += 1;
        const delay = Math.min(
          2 ** attempt * 250 + Math.random() * 250,
          this.opts.maxRetryDelayMs,
        );
        await sleep(delay);
        // Reconnect before retry.
        this.close();
      }
    }
  }

  /**
   * Two-stage agent run: send into a session, then wait for the terminal
   * response, collecting streamed `agent` events.
   */
  async runAgent(
    params: ReqParams,
    waitTimeoutMs: number,
    collectEvents = false,
    timeline?: GatewayTimeline,
  ): Promise<{ result: unknown; events?: RunEvents }> {
    await this.ensureConnected();
    const runEvents: RunEvents = { assistantChunks: [], toolCalls: [] };

    let sendResult: unknown;
    try {
      // `sessions.send` accepts only the documented params (key, message,
      // etc.). Model overrides are applied at session create / agent config,
      // never embedded in the send frame.
      timeline?.("T6_provider_request_started");
      sendResult = await this.requestOnce("sessions.send", params);
    } catch (err) {
      throw this.mapToEngineError(err, "sessions.send");
    }

    const runId =
      (sendResult as { runId?: string })?.runId ??
      (sendResult as { id?: string })?.id;
    if (!runId) {
      throw new EngineProtocolError("Gateway did not return a run id", {
        operation: "sessions.send",
        provider: "openclaw",
      });
    }
    if (collectEvents) {
      // `sessions.send` returns before the agent stream starts. Begin the
      // capture only after that boundary so late events from the previous
      // run cannot contaminate this turn.
      runEvents.toolCalls = [];
    }
    const runEventCapture = collectEvents
      ? this.startEventCapture(runEvents, runId, timeline)
      : null;

    let wait: unknown;
    try {
      wait = await this.requestOnce("agent.wait", { runId, timeoutMs: waitTimeoutMs });
    } catch (err) {
      const mapped = this.mapToEngineError(err, "agent.wait");
      runEventCapture?.stop();
      throw mapped;
    }
    runEventCapture?.stop();
    timeline?.("T8_provider_generation_completed", {
      status: String((wait as { status?: unknown })?.status ?? "unknown"),
    });
    return collectEvents ? { result: wait, events: runEvents } : { result: wait };
  }

  /**
   * Two-stage agent run that also returns the authoritative final assistant
   * message from history. Prefer this over `runAgent` for correctness: the
   * gateway's stored transcript is the source of truth for text, tool calls,
   * and usage (stream deltas can be noisy/interleaved).
   */
  async runAndReadResult(
    params: ReqParams,
    waitTimeoutMs: number,
    timeline?: GatewayTimeline,
  ): Promise<{
    runStatus: string;
    lastAssistant: {
      text?: string;
      usage?: {
        input?: number;
        output?: number;
        totalTokens?: number;
        cacheRead?: number;
      };
      model?: string;
      provider?: string;
      toolCalls?: Array<{ name: string; status: string }>;
    };
  }> {
    const key = String(params.key);
    const historyBefore = await this.chatHistory(key);
    const { result, events } = await this.runAgent(params, waitTimeoutMs, true, timeline);
    const runStatus = String((result as { status?: unknown })?.status ?? "");
    const history = await this.chatHistory(key);
    const messages = history?.messages ?? [];
    // A session can contain an aborted/empty assistant record after a timed
    // out run. Prefer the latest non-empty assistant produced by THIS run;
    // otherwise the empty terminal record masks valid text from the same
    // response and the caller falls through to a generic reply.
    const currentMessages = messages.length >= historyBefore.messages.length
      ? messages.slice(historyBefore.messages.length)
      : messages;
    const lastAssistant = [...currentMessages]
      .reverse()
      .find((m) =>
        (m as { role?: string }).role === "assistant" &&
        Boolean(extractText((m as { content?: unknown }).content)?.trim()),
      );
    const la = (lastAssistant ?? {}) as {
      content?: unknown;
      usage?: {
        input?: number;
        output?: number;
        totalTokens?: number;
        cacheRead?: number;
      };
      model?: string;
      provider?: string;
      api?: string;
      tool_calls?: Array<{ name?: string }>;
      toolCalls?: Array<{ name?: string }>;
    };
    // Tool calls must come from the history delta produced by this run.
    // Scanning the whole session history re-reports tools from earlier CEO
    // turns as if they belonged to this turn, breaking follow-up continuity.
    const toolNamesSet = new Set<string>();
    for (const m of currentMessages) {
      const mm = m as {
        toolName?: string;
        tool_calls?: Array<{ name?: string }>;
        toolCalls?: Array<{ name?: string }>;
        content?: unknown;
      };
      if (mm.toolName) toolNamesSet.add(mm.toolName);
      for (const tc of mm.tool_calls ?? []) {
        if (tc?.name) toolNamesSet.add(String(tc.name));
      }
      for (const tc of mm.toolCalls ?? []) {
        if (tc?.name) toolNamesSet.add(String(tc.name));
      }
      if (Array.isArray(mm.content)) {
        for (const part of mm.content) {
          const item = part as { type?: string; name?: string };
          if (item.type === "toolCall" && item.name) toolNamesSet.add(String(item.name));
        }
      }
    }
    const toolCalls = [...toolNamesSet].map((name) => ({
      name,
      status: "completed",
    }));
    const text = extractText(la.content) ?? (events?.assistantChunks?.join("") || undefined);
    timeline?.("T11_openclaw_final_response_completed", {
      status: runStatus,
      textBytes: text ? Buffer.byteLength(text, "utf8") : 0,
      toolCallCount: toolCalls.length,
    });
    return {
      runStatus,
      lastAssistant: {
        ...(text ? { text } : {}),
        ...(la.usage ? { usage: la.usage } : {}),
        ...(la.model ? { model: la.model } : {}),
        ...(la.provider ?? la.api ? { provider: la.provider ?? la.api } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    };
  }

  /** Read the raw chat history of a session (messages with usage/model). */
  async chatHistory(
    sessionKey: string,
  ): Promise<{ messages: Array<Record<string, unknown>> }> {
    await this.ensureConnected();
    const result = await this.request("chat.history", { sessionKey });
    return result as { messages: Array<Record<string, unknown>> };
  }

  /** List session rows (for getSession mapping and usage). */
  async describeSession(
    sessionKey: string,
  ): Promise<{ session?: Record<string, unknown> | null }> {
    await this.ensureConnected();
    const result = await this.request("sessions.describe", { key: sessionKey });
    return result as { session?: Record<string, unknown> | null };
  }

  /** List per-session usage rows. */
  async listUsage(
    agentId = AGENT_DEFAULT,
  ): Promise<{ sessions?: Array<Record<string, unknown>> }> {
    await this.ensureConnected();
    const result = await this.request("sessions.usage", { agentId });
    return result as { sessions?: Array<Record<string, unknown>> };
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  private requestOnce(method: string, params: ReqParams): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new EngineUnavailableError("Gateway not connected", {
          operation: method,
          provider: "openclaw",
          retryable: true,
        }),
      );
    }
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new EngineTimeoutError(`Gateway request timed out (${method})`, {
            operation: method,
            provider: "openclaw",
            retryable: true,
          }),
        );
      }, this.opts.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.ws?.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  private handleMessage(ev: MessageEvent): void {
    let frame: {
      type?: string;
      id?: string;
      ok?: boolean;
      payload?: unknown;
      error?: GatewayFrameError;
      event?: string;
    };
    try {
      frame = JSON.parse(String(ev.data));
    } catch {
      this.failPending(
        new EngineProtocolError("Gateway sent a non-JSON frame", {
          operation: "transport",
          provider: "openclaw",
        }),
      );
      return;
    }

    if (frame.type === "res") {
      const p = this.pending.get(String(frame.id));
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(String(frame.id));
        if (frame.ok) {
          p.resolve(frame.payload);
        } else {
          const err = new Error(
            frame.error?.message ?? "gateway rpc error",
          ) as GatewayRpcError;
          const code = frame.error?.code;
          if (code) err.gatewayCode = code;
          const details = frame.error?.details;
          if (details) err.gatewayDetails = details;
          const retryable = frame.error?.retryable;
          if (retryable !== undefined) err.retryable = retryable;
          const retryAfterMs = frame.error?.retryAfterMs;
          if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
          p.reject(err);
        }
      }
    } else if (frame.type === "event" && frame.event === "connect.challenge") {
      const payload = frame.payload as { nonce?: string; ts?: number };
      this.nonce = payload?.nonce ?? null;
      this.challengeTs = payload?.ts ?? 0;
    }
    // Other events (agent, health, etc.) are consumed by the run/capture path.
  }

  private waitForChallenge(timeoutMs: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.nonce) return resolve();
        if (Date.now() - start > timeoutMs) {
          return reject(
            new EngineProtocolError("Gateway did not send connect.challenge", {
              operation: "connect",
              provider: "openclaw",
            }),
          );
        }
        setTimeout(check, 30);
      };
      check();
    });
  }

  private buildDeviceAuth(deviceKeyPem: string): ReqParams {
    const privateKey = createPrivateKey(deviceKeyPem);
    const publicKey = createPublicKey(privateKey).export({
      type: "spki",
      format: "der",
    }) as Buffer;
    const PREFIX = Buffer.from("302a300506032b6570032100", "hex");
    const raw = publicKey.subarray(0, PREFIX.length).equals(PREFIX)
      ? publicKey.subarray(PREFIX.length)
      : publicKey;
    const deviceId = createHash("sha256").update(raw).digest("hex");
    const scopes = OPERATOR_SCOPES.join(",");
    const signedAt = this.challengeTs;
    const payload = [
      "v2",
      deviceId,
      "gateway-client",
      "backend",
      "operator",
      scopes,
      String(signedAt),
      this.opts.token ?? "",
      this.nonce ?? "",
    ].join("|");
    const signature = sign(null, Buffer.from(payload), privateKey).toString(
      "base64url",
    );
    return {
      id: deviceId,
      publicKey: raw.toString("base64url"),
      signature,
      signedAt,
      nonce: this.nonce ?? "",
    };
  }

  private startEventCapture(
    runEvents: RunEvents,
    activeRunId: string,
    timeline?: GatewayTimeline,
  ): { stop: () => void } {
    let firstEventSeen = false;
    const handler = (ev: MessageEvent) => {
      let frame: { type?: string; event?: string; payload?: AgentEvent };
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (frame.type !== "event" || frame.event !== "agent") return;
      const payload = frame.payload ?? {};
      if (payload.runId && payload.runId !== activeRunId) return;
      const stream = payload.stream;
      const data = payload.data ?? {};
      if (!firstEventSeen) {
        firstEventSeen = true;
        timeline?.("T7_provider_first_event", { stream: stream ?? "unknown" });
      }
      if (stream === "assistant") {
        // The gateway sends `data.delta` (incremental) and `data.text`
        // (running full text) per chunk. Use `delta` to avoid duplication.
        const d = data as { delta?: string; text?: string };
        const chunk = d.delta ?? d.text ?? "";
        if (chunk) {
          (runEvents.assistantChunks ??= []).push(chunk);
        }
      } else if (stream === "tool" || payload.status === "tool") {
        const name = String((data as { name?: string }).name ?? "tool");
        const status = String(payload.status ?? (data as { status?: string }).status ?? "completed");
        timeline?.(
          /start|call|invoke/i.test(status)
            ? "T9_tool_invocation_started"
            : "T10_tool_invocation_completed",
          { toolName: name, status },
        );
        (runEvents.toolCalls ??= []).push({ name, status: "completed" });
      } else if (stream === "lifecycle") {
        const status = String(payload.status ?? "");
        if (/error|failed|cancelled/i.test(status)) {
          runEvents.lifecycleError = String(
            (data as { message?: string }).message ?? status,
          );
        }
      }
    };
    this.ws?.addEventListener("message", handler);
    return { stop: () => this.ws?.removeEventListener("message", handler) };
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private mapToEngineError(err: unknown, operation: string): EngineError {
    if (err instanceof EngineError) {
      return err;
    }
    if (err instanceof Error && "gatewayCode" in err) {
      return mapGatewayError(err as GatewayRpcError, operation);
    }
    return new EngineProtocolError(
      err instanceof Error ? err.message : String(err),
      { operation, provider: "openclaw" },
    );
  }

  /** Expose latest config (used by adapter to read model override). */
  get config(): GatewayClientOptions {
    return this.opts;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract plain text from a gateway message `content` (string or parts[]). */
function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => {
        if (typeof c === "string") return c;
        const t = (c as { text?: string }).text;
        return typeof t === "string" ? t : undefined;
      })
      .filter((x): x is string => typeof x === "string");
    return parts.length > 0 ? parts.join("") : undefined;
  }
  if (content && typeof content === "object") {
    const t = (content as { text?: string }).text;
    if (typeof t === "string") return t;
  }
  return undefined;
}

export type { EngineErrorCode };
