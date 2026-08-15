import type {
  ConnectorExecutionError,
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  ConnectorProvider,
  ConnectorRuntime,
} from "./contracts.js";

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpConnectorRuntimeConfig {
  readonly provider: Exclude<ConnectorProvider, "activepieces">;
  readonly endpoint: string;
  /** Resolved only inside the secure execution boundary; never from request input. */
  readonly authHeaders?: (context: Pick<ConnectorExecutionRequest, "organizationId" | "userId" | "capability">) => Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
  /** Optional explicit mapping; discovery remains the source of truth for schemas. */
  readonly capabilityToolHints?: Readonly<Record<string, readonly string[]>>;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly protocolVersion?: string;
  readonly onEvent?: (event: McpRuntimeEvent) => void;
}

export interface McpRuntimeEvent {
  readonly event: "started" | "discovered" | "completed" | "failed";
  readonly provider: ConnectorProvider;
  readonly requestId?: string;
  readonly capability?: string;
  readonly organizationId?: string;
  readonly toolCount?: number;
  readonly tool?: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
  readonly sessionId?: string;
}

interface McpSession {
  readonly sessionId?: string;
  readonly tools: readonly McpToolDescriptor[];
}

const SECRET_KEY_PATTERN = /(authorization|access.?token|refresh.?token|api.?key|client.?secret|password|secret|developer.?token|cookie|bearer)/i;

/**
 * Streamable-HTTP MCP runtime used by official advertising providers.
 *
 * It discovers `tools/list` at runtime and only keeps a business capability →
 * tool-name hint outside the protocol layer. Provider credentials are supplied
 * by a closure owned by the secure credential layer and never appear in a
 * request, result, event, or error.
 */
export class McpConnectorRuntime implements ConnectorRuntime {
  readonly provider: Exclude<ConnectorProvider, "activepieces">;

  private readonly endpoint: string;
  private readonly authHeaders?: McpConnectorRuntimeConfig["authHeaders"];
  private readonly capabilityToolHints: Readonly<Record<string, readonly string[]>>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly protocolVersion: string;
  private readonly onEvent: ((event: McpRuntimeEvent) => void) | undefined;
  private readonly sessionPromises = new Map<string, Promise<McpSession>>();

  constructor(config: McpConnectorRuntimeConfig) {
    this.provider = config.provider;
    this.endpoint = config.endpoint.trim();
    this.authHeaders = config.authHeaders;
    this.capabilityToolHints = config.capabilityToolHints ?? {};
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.protocolVersion = config.protocolVersion ?? "2025-06-18";
    this.onEvent = config.onEvent;
  }

  async health(signal?: AbortSignal): Promise<ConnectorHealthResult> {
    const started = Date.now();
    if (!this.endpoint) {
      return { provider: this.provider, healthy: false, status: 0, durationMs: 0, error: "Provider is not configured." };
    }
    try {
      await this.getSession({ requestId: "health", organizationId: "system", capability: "provider.health", operation: "execute", input: {}, sideEffect: false }, signal);
      return { provider: this.provider, healthy: true, status: 200, durationMs: Date.now() - started };
    } catch (cause) {
      return {
        provider: this.provider,
        healthy: false,
        status: statusFromError(cause),
        durationMs: Date.now() - started,
        error: safeErrorMessage(cause),
      };
    }
  }

  async execute<TOutput = unknown>(
    request: ConnectorExecutionRequest,
    signal?: AbortSignal,
  ): Promise<ConnectorExecutionResult<TOutput>> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const finish = (
      result: Omit<ConnectorExecutionResult<TOutput>, "requestId" | "organizationId" | "provider" | "capability" | "operation" | "startedAt" | "completedAt" | "durationMs">,
    ): ConnectorExecutionResult<TOutput> => {
      const output = {
        requestId: request.requestId,
        organizationId: request.organizationId,
        provider: this.provider,
        capability: request.capability,
        operation: request.operation,
        ...result,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      };
      this.onEvent?.({
        event: output.status === "succeeded" || output.status === "prepared" ? "completed" : "failed",
        provider: this.provider,
        requestId: request.requestId,
        capability: request.capability,
        organizationId: request.organizationId,
        status: output.status,
        durationMs: output.durationMs,
        ...(output.error ? { errorCode: output.error.code } : {}),
      });
      return output;
    };

    this.onEvent?.({ event: "started", provider: this.provider, requestId: request.requestId, capability: request.capability, organizationId: request.organizationId });
    if (!request.requestId || !request.organizationId || !request.capability) {
      return finish({ status: "failed", error: connectorError("invalid_request", "The request could not be validated.", false) });
    }
    if (hasSecretKey(request.input)) {
      return finish({ status: "failed", error: connectorError("secret_payload_rejected", "The request contains a credential-shaped field.", false) });
    }
    if (
      Object.prototype.hasOwnProperty.call(request.input, "organizationId") ||
      Object.prototype.hasOwnProperty.call(request.input, "tenantId") ||
      Object.prototype.hasOwnProperty.call(request.input, "accountId") ||
      Object.prototype.hasOwnProperty.call(request.input, "customerId")
    ) {
      return finish({ status: "failed", error: connectorError("tenant_mismatch", "The authenticated organization cannot be overridden.", false) });
    }
    if (request.operation === "prepare") return finish({ status: "prepared" });
    if (!this.endpoint) return finish({ status: "not_configured", error: connectorError("provider_unavailable", "This advertising connection is not configured.", false) });

    try {
      const session = await this.getSession(request, signal);
      const tool = selectTool(request.capability, session.tools, this.capabilityToolHints);
      if (!tool) {
        return finish({ status: "not_configured", error: connectorError("mcp_tool_unavailable", "This advertising capability is not available for the connected account.", false) });
      }
      this.onEvent?.({ event: "discovered", provider: this.provider, requestId: request.requestId, capability: request.capability, organizationId: request.organizationId, tool: tool.name, toolCount: session.tools.length });
      const response = await this.rpc("tools/call", { name: tool.name, arguments: request.input }, session.sessionId, signal, false, request);
      if (response.error) {
        return finish({ status: "failed", error: connectorError("mcp_protocol_error", "The advertising provider could not complete the operation.", false) });
      }
      const result = asRecord(response.result);
      if (result?.isError === true) {
        return finish({ status: "failed", error: connectorError("mcp_protocol_error", "The advertising provider reported that the operation failed.", false) });
      }
      return finish({ output: redactSecrets((response.result ?? {}) as TOutput), status: "succeeded" });
    } catch (cause) {
      const code: ConnectorExecutionError["code"] = signal?.aborted
        ? "cancelled"
        : statusFromError(cause) === 401 || statusFromError(cause) === 403
        ? "unauthorized"
        : cause instanceof TimeoutError
          ? "timeout"
          : "mcp_transport_error";
      return finish({
        status: code === "unauthorized" ? "unauthorized" : code === "timeout" ? "timeout" : code === "cancelled" ? "cancelled" : "failed",
        error: connectorError(code, code === "unauthorized" ? "This advertising connection needs to be reconnected." : code === "timeout" ? "The advertising operation timed out. You can try again." : code === "cancelled" ? "The advertising operation was cancelled." : "We could not complete the advertising operation. You can try again.", code !== "unauthorized" && code !== "cancelled"),
      });
    }
  }

  private async getSession(request: ConnectorExecutionRequest, signal?: AbortSignal): Promise<McpSession> {
    const sessionKey = `${request.organizationId}:${request.userId ?? "system"}`;
    const existing = this.sessionPromises.get(sessionKey);
    if (existing) return existing;
    const sessionPromise = this.openSession(request, signal).catch((error) => {
        this.sessionPromises.delete(sessionKey);
        throw error;
      });
    this.sessionPromises.set(sessionKey, sessionPromise);
    return sessionPromise;
  }

  private async openSession(request: ConnectorExecutionRequest, signal?: AbortSignal): Promise<McpSession> {
    const initialized = await this.rpc("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "departify-connector-runtime", version: "0.1.0" },
    }, undefined, signal, false, request);
    if (!initialized.result || initialized.error) throw new McpProtocolError();
    await this.rpc("notifications/initialized", undefined, initialized.sessionId, signal, true, request);
    const listed = await this.rpc("tools/list", {}, initialized.sessionId, signal, false, request);
    if (listed.error) throw new McpProtocolError();
    const result = asRecord(listed.result);
    const rawTools = Array.isArray(result?.tools) ? result.tools : [];
    const tools = rawTools.flatMap((value): McpToolDescriptor[] => {
      const record = asRecord(value);
      return typeof record?.name === "string" ? [{ name: record.name, ...(typeof record.description === "string" ? { description: record.description } : {}), ...(record.inputSchema !== undefined ? { inputSchema: record.inputSchema } : {}) }] : [];
    });
    if (tools.length === 0) throw new McpProtocolError();
    this.onEvent?.({ event: "discovered", provider: this.provider, toolCount: tools.length });
    return { tools, ...(initialized.sessionId ? { sessionId: initialized.sessionId } : {}) };
  }

  private async rpc(method: string, params: unknown, sessionId?: string, signal?: AbortSignal, notification = false, context?: Pick<ConnectorExecutionRequest, "organizationId" | "userId" | "capability">): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const auth = this.authHeaders ? await this.authHeaders(context ?? { organizationId: "system", capability: "provider.health" }) : {};
      const headers: Record<string, string> = {
        Accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "MCP-Protocol-Version": this.protocolVersion,
        ...auth,
      };
      if (sessionId) headers["mcp-session-id"] = sessionId;
      const body = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: `${Date.now()}-${Math.random()}`, method, params };
      const response = await this.fetchImpl(this.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new HttpStatusError(response.status);
      const payload = await parseMcpResponse(response);
      return {
        ...(payload && typeof payload === "object" ? payload as JsonRpcResponse : {}),
        ...(response.headers.get("mcp-session-id") ? { sessionId: response.headers.get("mcp-session-id")! } : {}),
      };
    } catch (cause) {
      if (controller.signal.aborted) throw new TimeoutError();
      throw cause;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function selectTool(capability: string, tools: readonly McpToolDescriptor[], hints: Readonly<Record<string, readonly string[]>>): McpToolDescriptor | null {
  const candidates = hints[capability] ?? [];
  for (const candidate of candidates) {
    const exact = tools.find((tool) => tool.name === candidate);
    if (exact) return exact;
  }
  const terms = capability.toLowerCase().split(".").filter((term) => term !== "marketing" && term !== "ads");
  return tools.find((tool) => terms.every((term) => tool.name.toLowerCase().includes(term) || (tool.description ?? "").toLowerCase().includes(term))) ?? null;
}

async function parseMcpResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(text);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasSecretKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasSecretKey);
  return Object.entries(value).some(([key, child]) => SECRET_KEY_PATTERN.test(key) || hasSecretKey(child));
}

function redactSecrets<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(child);
  return output as T;
}

function connectorError(code: ConnectorExecutionError["code"], message: string, retryable: boolean): ConnectorExecutionError {
  return { code, message, retryable };
}

function statusFromError(error: unknown): number {
  return error instanceof HttpStatusError ? error.status : 0;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof HttpStatusError) return `Provider returned HTTP ${error.status}.`;
  if (error instanceof TimeoutError) return "Provider request timed out.";
  return "Provider health check failed.";
}

class HttpStatusError extends Error { constructor(readonly status: number) { super("provider_http_error"); } }
class TimeoutError extends Error { constructor() { super("provider_timeout"); } }
class McpProtocolError extends Error { constructor() { super("provider_protocol_error"); } }
