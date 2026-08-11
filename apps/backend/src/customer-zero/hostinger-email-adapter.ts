/**
 * Hostinger Email provider adapter.
 *
 * Hostinger exposes a remote MCP server, but MCP is an infrastructure detail:
 * the rest of Departify only sees normalized email operations. This adapter
 * speaks Streamable HTTP JSON-RPC directly, discovers the provider's actual
 * tools at runtime, and never invents a tool name or schema.
 */

import { resolveHostingerCredentials } from "./credential-resolver.js";

const DEFAULT_URL = "https://mcp.mail.hostinger.com/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const CALL_TIMEOUT_MS = 15_000;

export type HostingerCapability =
  | "email.read"
  | "email.search"
  | "email.send"
  | "email.reply"
  | "email.move"
  | "email.flag"
  | "email.delete"
  | "email.folders.list"
  | "email.mailboxes.list"
  | "email.webhooks.manage";

export interface HostingerMcpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: {
    readonly type?: string;
    readonly properties?: Readonly<Record<string, { type?: string; description?: string }>>;
    readonly required?: readonly string[];
  };
}

export interface NormalizedEmailMessage {
  readonly provider: "hostinger";
  readonly providerMessageId: string;
  readonly providerThreadId?: string;
  readonly mailbox?: string;
  readonly folder?: string;
  readonly from: { readonly email: string; readonly displayName?: string };
  readonly to: readonly { readonly email: string; readonly displayName?: string }[];
  readonly cc: readonly { readonly email: string; readonly displayName?: string }[];
  readonly subject: string;
  readonly preview: string;
  readonly receivedAt: string;
  readonly sentAt?: string;
  readonly unread: boolean;
  readonly flagged: boolean;
}

export interface HostingerToolMapping {
  readonly capabilities: Readonly<Partial<Record<HostingerCapability, string>>>;
  readonly tools: readonly HostingerMcpTool[];
}

export interface HostingerConnectionStatus {
  readonly configured: boolean;
  readonly state: "not_connected" | "connected" | "needs_attention" | "error";
  readonly capabilities: readonly HostingerCapability[];
  readonly checkedAt: string;
  readonly errorCategory?: HostingerErrorCategory;
}

export type HostingerErrorCategory =
  | "MCP_CONNECTION_FAILED"
  | "MCP_INITIALIZATION_FAILED"
  | "MCP_AUTH_FAILED"
  | "MCP_TOOL_NOT_FOUND"
  | "MCP_TOOL_CALL_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "UNKNOWN_PROVIDER_FAILURE";

export class HostingerEmailError extends Error {
  readonly category: HostingerErrorCategory;

  constructor(category: HostingerErrorCategory, message: string) {
    super(message);
    this.name = "HostingerEmailError";
    this.category = category;
  }
}

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
}

interface HostingerTransportOptions {
  readonly url: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/** One adapter instance represents one request-scoped provider session. */
export class HostingerEmailAdapter {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private requestId = 0;
  private sessionId: string | null = null;
  private mapping: HostingerToolMapping | null = null;

  constructor(options?: Partial<HostingerTransportOptions>) {
    const credentials = resolveHostingerCredentials();
    this.url = options?.url ?? credentials?.url ?? DEFAULT_URL;
    this.token = options?.token ?? credentials?.token ?? "";
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.now = options?.now ?? Date.now;
  }

  get discoveredMapping(): HostingerToolMapping | null {
    return this.mapping;
  }

  async discover(): Promise<HostingerToolMapping> {
    await this.initialize();
    const response = await this.request("tools/list", {});
    const tools = parseTools(response);
    if (tools.length === 0) {
      throw new HostingerEmailError("MCP_INITIALIZATION_FAILED", "Hostinger no ha publicado herramientas.");
    }
    this.mapping = { tools, capabilities: mapDiscoveredCapabilities(tools) };
    return this.mapping;
  }

  async verify(): Promise<HostingerToolMapping> {
    const mapping = this.mapping ?? (await this.discover());
    if (!Object.keys(mapping.capabilities).some((capability) => capability.startsWith("email."))) {
      throw new HostingerEmailError("MCP_TOOL_NOT_FOUND", "Hostinger no ofrece una capacidad de correo compatible.");
    }
    return mapping;
  }

  async listMailboxes(): Promise<readonly string[]> {
    const tool = await this.toolFor("email.mailboxes.list");
    const result = await this.callTool(tool, buildArguments(tool, {}));
    return extractStringList(result, ["mailboxes", "mailbox", "name", "email", "address"]);
  }

  async readRecentMessages(maxResults = 5): Promise<readonly NormalizedEmailMessage[]> {
    const tool = await this.toolFor("email.read", "email.search");
    const result = await this.callTool(tool, buildArguments(tool, { limit: maxResults, maxResults }));
    return normalizeMessages(result);
  }

  async searchMessages(query: string, maxResults = 5): Promise<readonly NormalizedEmailMessage[]> {
    const tool = await this.toolFor("email.search", "email.read");
    const result = await this.callTool(
      tool,
      buildArguments(tool, { query, search: query, q: query, limit: maxResults, maxResults }),
    );
    return normalizeMessages(result);
  }

  async sendMessage(input: {
    readonly to: readonly string[];
    readonly subject: string;
    readonly bodyText: string;
  }): Promise<{ readonly providerMessageId: string; readonly sentAt: string }> {
    const tool = await this.toolFor("email.send");
    const result = await this.callTool(
      tool,
      buildArguments(tool, {
        to: input.to,
        recipients: input.to,
        subject: input.subject,
        body: input.bodyText,
        bodyText: input.bodyText,
        text: input.bodyText,
      }),
    );
    const messageId = extractString(result, ["messageId", "message_id", "id", "providerMessageId"]);
    if (!messageId) {
      throw new HostingerEmailError("MCP_TOOL_CALL_FAILED", "Hostinger no ha devuelto un identificador de mensaje.");
    }
    return { providerMessageId: messageId, sentAt: new Date(this.now()).toISOString() };
  }

  async replyMessage(input: {
    readonly messageId: string;
    readonly bodyText: string;
  }): Promise<{ readonly providerMessageId: string; readonly sentAt: string }> {
    const tool = await this.toolFor("email.reply");
    const result = await this.callTool(
      tool,
      buildArguments(tool, {
        messageId: input.messageId,
        id: input.messageId,
        body: input.bodyText,
        bodyText: input.bodyText,
        text: input.bodyText,
      }),
    );
    const messageId = extractString(result, ["messageId", "message_id", "id", "providerMessageId"]);
    if (!messageId) {
      throw new HostingerEmailError("MCP_TOOL_CALL_FAILED", "Hostinger no ha confirmado la respuesta.");
    }
    return { providerMessageId: messageId, sentAt: new Date(this.now()).toISOString() };
  }

  private async toolFor(...capabilities: HostingerCapability[]): Promise<HostingerMcpTool> {
    const mapping = this.mapping ?? (await this.discover());
    for (const capability of capabilities) {
      const name = mapping.capabilities[capability];
      if (name) {
        const tool = mapping.tools.find((candidate) => candidate.name === name);
        if (tool) return tool;
      }
    }
    throw new HostingerEmailError("MCP_TOOL_NOT_FOUND", "La operación de correo no está disponible.");
  }

  private async initialize(): Promise<void> {
    if (!this.token) throw new HostingerEmailError("MCP_AUTH_FAILED", "Hostinger no está configurado.");
    const result = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "departify", version: "1.0.0" },
      },
      "MCP_INITIALIZATION_FAILED",
    );
    if (!result || typeof result !== "object") {
      throw new HostingerEmailError("MCP_INITIALIZATION_FAILED", "Respuesta de inicialización inválida.");
    }
    await this.notify("notifications/initialized", {});
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.sendHttp({ jsonrpc: "2.0", method, params });
  }

  private async request(method: string, params: unknown, failureCategory: HostingerErrorCategory = "MCP_TOOL_CALL_FAILED"): Promise<unknown> {
    const id = ++this.requestId;
    const response = await this.sendHttp({ jsonrpc: "2.0", id, method, params }, failureCategory);
    if (response.error) {
      const message = response.error.message ?? "Hostinger MCP error";
      if (response.error.code === -32001 || /auth|unauthori[sz]|forbidden|token/i.test(message)) {
        throw new HostingerEmailError("MCP_AUTH_FAILED", "Hostinger no ha autorizado la operación.");
      }
      throw new HostingerEmailError(failureCategory, sanitizeProviderMessage(message));
    }
    return response.result;
  }

  private async callTool(tool: HostingerMcpTool, argumentsValue: Readonly<Record<string, unknown>>): Promise<unknown> {
    const result = await this.request("tools/call", { name: tool.name, arguments: argumentsValue });
    return unwrapToolResult(result);
  }

  private async sendHttp(payload: Readonly<Record<string, unknown>>, failureCategory: HostingerErrorCategory = "MCP_CONNECTION_FAILED"): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        Authorization: `Bearer ${this.token}`,
      };
      if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const returnedSession = response.headers.get("mcp-session-id");
      if (returnedSession) this.sessionId = returnedSession;
      if (response.status === 401 || response.status === 403) {
        throw new HostingerEmailError("MCP_AUTH_FAILED", "Hostinger no ha autorizado la conexión.");
      }
      if (!response.ok) {
        throw new HostingerEmailError(failureCategory, `Hostinger respondió con estado ${response.status}.`);
      }
      return parseJsonRpc(await response.text());
    } catch (cause) {
      if (cause instanceof HostingerEmailError) throw cause;
      if (controller.signal.aborted) throw new HostingerEmailError("TIMEOUT", "Hostinger no respondió a tiempo.");
      throw new HostingerEmailError(failureCategory, "No se pudo conectar con Hostinger.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Live, secret-free connection projection for /conexiones. */
export async function probeHostingerEmail(): Promise<HostingerConnectionStatus> {
  const configured = Boolean(resolveHostingerCredentials());
  const checkedAt = new Date().toISOString();
  if (!configured) return { configured: false, state: "not_connected", capabilities: [], checkedAt };
  try {
    const mapping = await new HostingerEmailAdapter().verify();
    const capabilities = Object.keys(mapping.capabilities) as HostingerCapability[];
    return { configured: true, state: "connected", capabilities, checkedAt };
  } catch (cause) {
    const category = cause instanceof HostingerEmailError ? cause.category : "UNKNOWN_PROVIDER_FAILURE";
    return {
      configured: true,
      state: category === "MCP_AUTH_FAILED" ? "needs_attention" : "error",
      capabilities: [],
      checkedAt,
      errorCategory: category,
    };
  }
}

export function mapDiscoveredCapabilities(tools: readonly HostingerMcpTool[]): Readonly<Partial<Record<HostingerCapability, string>>> {
  const result: Partial<Record<HostingerCapability, string>> = {};
  for (const tool of tools) {
    const text = `${tool.name} ${tool.description ?? ""}`.toLocaleLowerCase("en-US");
    const assign = (capability: HostingerCapability, score: number): void => {
      const existing = result[capability];
      if (!existing || score > toolScore(existing, tools)) result[capability] = tool.name;
    };
    if (/(mailbox|mailboxes)/.test(text) && /(list|get|show|read)/.test(text)) assign("email.mailboxes.list", 4);
    if (/folder/.test(text) && /(list|get|show)/.test(text)) assign("email.folders.list", 4);
    if (/webhook/.test(text)) assign("email.webhooks.manage", 4);
    if (/(search|find|query)/.test(text) && /(mail|message|email)/.test(text)) assign("email.search", 4);
    if (/(list|recent|inbox|read|fetch|get)/.test(text) && /(mail|message|email)/.test(text) && !/(send|reply|delete)/.test(text)) assign("email.read", 3);
    if (/(send|compose)/.test(text) && /(mail|message|email)/.test(text)) assign("email.send", 5);
    if (/(reply|respond)/.test(text) && /(mail|message|email)/.test(text)) assign("email.reply", 5);
    if (/\bmove\b/.test(text) && /(mail|message|email)/.test(text)) assign("email.move", 5);
    if (/(flag|star)/.test(text) && /(mail|message|email)/.test(text)) assign("email.flag", 5);
    if (/(delete|remove|trash)/.test(text) && /(mail|message|email)/.test(text)) assign("email.delete", 5);
  }
  return result;
}

function toolScore(name: string, tools: readonly HostingerMcpTool[]): number {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return 0;
  const text = `${tool.name} ${tool.description ?? ""}`.toLocaleLowerCase("en-US");
  if (/(send|reply|respond|move|flag|delete)/.test(text)) return 5;
  return /(search|find|query|list|read|get)/.test(text) ? 4 : 1;
}

function parseJsonRpc(text: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("data:")) {
    const data = trimmed.split(/\r?\n/).find((line) => line.startsWith("data:"));
    return parseJsonRpc(data?.slice(5).trim() ?? "");
  }
  try {
    return JSON.parse(trimmed) as JsonRpcResponse;
  } catch {
    throw new HostingerEmailError("MCP_INITIALIZATION_FAILED", "Respuesta MCP inválida.");
  }
}

function parseTools(result: unknown): HostingerMcpTool[] {
  const value = result as { tools?: unknown } | null;
  if (!value || !Array.isArray(value.tools)) return [];
  return value.tools.filter((tool): tool is HostingerMcpTool => Boolean(tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string"));
}

function unwrapToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const content = record.content;
  if (!Array.isArray(content)) return value;
  const texts = content
    .filter((entry): entry is { text: string } => Boolean(entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string"))
    .map((entry) => entry.text);
  if (texts.length === 0) return value;
  const joined = texts.join("\n").trim();
  try {
    return JSON.parse(joined) as unknown;
  } catch {
    return joined;
  }
}

function buildArguments(tool: HostingerMcpTool, values: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const properties = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    const normalized = key.toLocaleLowerCase("en-US");
    const aliases: Record<string, readonly string[]> = {
      query: ["query", "search", "q", "keyword", "text"],
      limit: ["limit", "maxresults", "max_results", "count", "page_size"],
      to: ["to", "recipient", "recipients", "email", "emails"],
      subject: ["subject", "title"],
      body: ["body", "bodytext", "body_text", "text", "content", "message"],
      messageid: ["messageid", "message_id", "id"],
      threadid: ["threadid", "thread_id"],
    };
    const candidates = aliases[normalized] ?? [normalized];
    const source = Object.entries(values).find(([sourceKey]) => candidates.includes(sourceKey.toLocaleLowerCase("en-US")));
    if (source) output[key] = source[1];
  }
  for (const key of required) {
    if (!(key in output)) throw new HostingerEmailError("INVALID_REQUEST", "La herramienta de Hostinger requiere datos no compatibles.");
  }
  return output;
}

function extractString(value: unknown, keys: readonly string[]): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const child of Object.values(record)) {
    const found = extractString(child, keys);
    if (found) return found;
  }
  return null;
}

function extractStringList(value: unknown, keys: readonly string[]): readonly string[] {
  const array = findArray(value);
  if (!array) return [];
  return array.map((item) => extractString(item, keys)).filter((item): item is string => Boolean(item));
}

function normalizeMessages(value: unknown): readonly NormalizedEmailMessage[] {
  const array = findArray(value) ?? [];
  return array.map(normalizeMessage).filter((item): item is NormalizedEmailMessage => item !== null);
}

function normalizeMessage(value: unknown): NormalizedEmailMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = extractString(record, ["providerMessageId", "messageId", "message_id", "id"]);
  if (!id) return null;
  const address = (candidate: unknown): { email: string; displayName?: string } => {
    if (typeof candidate === "string") return { email: candidate };
    const object = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    const email = extractString(object, ["email", "address", "mail"]) ?? "desconocido";
    const displayName = extractString(object, ["displayName", "display_name", "name"]);
    return displayName ? { email, displayName } : { email };
  };
  const from = address(record.from ?? record.sender);
  const list = (candidate: unknown): readonly { email: string; displayName?: string }[] => Array.isArray(candidate) ? candidate.map(address) : candidate ? [address(candidate)] : [];
  return {
    provider: "hostinger",
    providerMessageId: id,
    ...(extractString(record, ["threadId", "thread_id"]) ? { providerThreadId: extractString(record, ["threadId", "thread_id"])! } : {}),
    ...(extractString(record, ["mailbox", "mailboxName"]) ? { mailbox: extractString(record, ["mailbox", "mailboxName"])! } : {}),
    ...(extractString(record, ["folder", "folderName"]) ? { folder: extractString(record, ["folder", "folderName"])! } : {}),
    from,
    to: list(record.to),
    cc: list(record.cc),
    subject: extractString(record, ["subject", "title"]) ?? "",
    preview: extractString(record, ["preview", "snippet", "body", "text"]) ?? "",
    receivedAt: extractString(record, ["receivedAt", "received_at", "date", "timestamp"]) ?? new Date().toISOString(),
    ...(extractString(record, ["sentAt", "sent_at"]) ? { sentAt: extractString(record, ["sentAt", "sent_at"])! } : {}),
    unread: Boolean(record.unread ?? record.isUnread ?? record.is_unread),
    flagged: Boolean(record.flagged ?? record.isFlagged ?? record.is_flagged),
  };
}

function findArray(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["messages", "emails", "items", "data", "results", "mailboxes"]) {
    if (Array.isArray(record[key])) return record[key] as readonly unknown[];
  }
  for (const child of Object.values(record)) {
    const found = findArray(child);
    if (found) return found;
  }
  return null;
}

function sanitizeProviderMessage(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[\r\n]+/g, " ").slice(0, 180);
}
