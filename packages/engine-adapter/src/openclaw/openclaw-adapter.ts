/**
 * OpenClawEngineAdapter — the Departify ↔ OpenClaw boundary.
 *
 * Owns ALL OpenClaw-specific mapping:
 * - Departify session id ↔ OpenClaw session key (`departify:<id>`)
 * - gateway history → EngineHistory
 * - gateway usage/agentMeta → EngineUsage
 * - gateway tool policy → EngineToolState
 * - session close semantics (sessions.delete = archive + remove active)
 *
 * Nothing outside this class may know OpenClaw session keys, run ids, event
 * types, or frame shapes.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { EngineAdapterConfig } from "@departify/config";
import type { EngineAdapter } from "../contract.js";
import {
  EngineError,
  EngineExecutionError,
  EngineProtocolError,
  EngineSessionNotFoundError,
} from "../errors.js";
import type {
  EngineBusinessToolDefinition,
  EngineHealth,
  EngineHistory,
  EngineHistoryItem,
  EngineMessageResult,
  EngineSendMessageInput,
  EngineSession,
  EngineToolState,
  EngineUsage,
} from "../types.js";
import { OpenClawGatewayClient } from "./gateway-client.js";

const AGENT_ID = "main";
const SESSION_KEY_PREFIX = "departify:";

/** True when the gateway URL targets the local loopback host. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function readDeviceKey(path?: string): string | undefined {
  if (!path) return undefined;
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

export class OpenClawEngineAdapter implements EngineAdapter {
  private readonly client: OpenClawGatewayClient;
  private readonly model: string | undefined;

  constructor(config: EngineAdapterConfig) {
    const url = config.gatewayUrl;
    if (!url) {
      throw new EngineProtocolError(
        "OPENCLAW_GATEWAY_URL is required to build the OpenClaw engine adapter",
        { operation: "constructor", provider: "openclaw" },
      );
    }
    this.model = config.model;
    const deviceKeyPem = config.deviceKeyPem ?? readDeviceKey(config.deviceKeyPath);
    this.client = new OpenClawGatewayClient({
      url,
      ...(config.gatewayToken ? { token: config.gatewayToken } : {}),
      connectTimeoutMs: config.connectTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
      retryLimit: config.retryLimit,
      maxRetryDelayMs: config.maxRetryDelayMs,
      ...(deviceKeyPem ? { deviceKeyPem } : {}),
    });
  }

  /* ------------------------- EngineAdapter contract ------------------------- */

  async createSession(input: { sessionId?: string; model?: string } = {}): Promise<EngineSession> {
    const id = input.sessionId ?? randomUUID();
    await this.client.request("sessions.create", {
      key: sessionKey(id),
      agentId: AGENT_ID,
      ...(this.resolveModel(input.model) ? { model: this.resolveModel(input.model) } : {}),
    });
    const now = new Date().toISOString();
    return { id, status: "active", createdAt: now, updatedAt: now };
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    const startedAt = Date.now();
    try {
      const { runStatus, lastAssistant } = await this.client.runAndReadResult(
        {
          key: sessionKey(input.sessionId),
          message: renderOpenClawTurn(input),
        },
        this.client.config.requestTimeoutMs,
      );
      if (runStatus !== "ok") {
        throw new EngineExecutionError(
          `Agent run finished with status "${runStatus}"`,
          { operation: "sendMessage", provider: "openclaw" },
        );
      }
      const text = lastAssistant.text ?? "";
      const toolCalls = (lastAssistant.toolCalls ?? []).map((tc) => ({
        name: tc.name,
        status: "completed" as const,
      }));
      const durationMs = Date.now() - startedAt;
      return {
        sessionId: input.sessionId,
        text,
        status: "completed",
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(lastAssistant.usage
          ? {
              usage: {
                ...(lastAssistant.provider ? { provider: lastAssistant.provider } : {}),
                ...(lastAssistant.model ? { model: lastAssistant.model } : {}),
                ...(lastAssistant.usage.input !== undefined
                  ? { inputTokens: lastAssistant.usage.input }
                  : {}),
                ...(lastAssistant.usage.output !== undefined
                  ? { outputTokens: lastAssistant.usage.output }
                  : {}),
                ...(lastAssistant.usage.totalTokens !== undefined
                  ? { totalTokens: lastAssistant.usage.totalTokens }
                  : {}),
                ...(lastAssistant.usage.cacheRead !== undefined
                  ? { cacheReadTokens: lastAssistant.usage.cacheRead }
                  : {}),
              },
            }
          : {}),
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err instanceof EngineSessionNotFoundError) throw err;
      if (err instanceof EngineError) {
        return {
          sessionId: input.sessionId,
          text: "",
          status: "failed",
          errorCode: err.code,
          durationMs,
        };
      }
      throw err;
    }
  }

  async getSession(sessionId: string): Promise<EngineSession | null> {
    try {
      const result = await this.client.describeSession(sessionKey(sessionId));
      const session = result?.session;
      if (!session) return null;
      const s = session as {
        sessionId?: string;
        updatedAt?: number;
        archived?: boolean;
      };
      return {
        id: sessionId,
        status: s.archived ? "closed" : "active",
        ...(s.updatedAt ? { updatedAt: new Date(s.updatedAt).toISOString() } : {}),
      };
    } catch (err) {
      if (err instanceof EngineSessionNotFoundError) return null;
      throw err;
    }
  }

  async getHistory(sessionId: string): Promise<EngineHistory> {
    const result = await this.client.chatHistory(sessionKey(sessionId));
    const messages = result?.messages ?? [];
    const items: EngineHistoryItem[] = [];
    for (const raw of messages) {
      const m = raw as {
        role?: string;
        content?: unknown;
        timestamp?: number;
        toolName?: string;
      };
      const role = normalizeRole(m.role);
      const text = contentToText(m.content);
      const createdAt = m.timestamp
        ? new Date(m.timestamp).toISOString()
        : undefined;
      items.push({
        role,
        ...(text !== undefined ? { text } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(m.toolName ? { toolName: m.toolName } : {}),
      });
    }
    return { sessionId, items };
  }

  async closeSession(sessionId: string): Promise<void> {
    // `sessions.delete` archives the transcript and removes the active session
    // row — the closest native "close" that preserves history on disk.
    await this.client.request("sessions.delete", { key: sessionKey(sessionId) });
  }

  async getUsage(sessionId: string): Promise<EngineUsage> {
    // Try the per-session usage ledger first.
    const result = await this.client.listUsage(AGENT_ID);
    const sessions = result?.sessions ?? [];
    const key = sessionKey(sessionId);
    const row = sessions.find(
      (s) => (s as { key?: string }).key === key,
    ) as
      | {
          modelProvider?: string;
          model?: string;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
            cacheRead?: number;
          } | null;
        }
      | undefined;

    let provider = row?.modelProvider ?? "openclaw";
    let model = row?.model ?? this.model;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let totalTokens: number | undefined;
    let cacheReadTokens: number | undefined;

    if (row?.usage) {
      inputTokens = row.usage.inputTokens;
      outputTokens = row.usage.outputTokens;
      totalTokens = row.usage.totalTokens;
      cacheReadTokens = row.usage.cacheRead;
    }

    // The ledger may be empty right after a run; fall back to the last
    // assistant message's per-message usage from history.
    if (inputTokens === undefined) {
      try {
        const history = await this.client.chatHistory(key);
        const last = [...(history?.messages ?? [])]
          .reverse()
          .find((m) => (m as { role?: string }).role === "assistant");
        const usage = last
          ? ((last as { usage?: Record<string, unknown> }).usage as
              | {
                  input?: number;
                  output?: number;
                  inputTokens?: number;
                  outputTokens?: number;
                  totalTokens?: number;
                  cacheRead?: number;
                }
              | undefined)
          : undefined;
        if (usage) {
          inputTokens =
            (usage.input as number | undefined) ??
            (usage.inputTokens as number | undefined);
          outputTokens =
            (usage.output as number | undefined) ??
            (usage.outputTokens as number | undefined);
          totalTokens = usage.totalTokens as number | undefined;
          cacheReadTokens = usage.cacheRead as number | undefined;
          const m = last as { model?: string; provider?: string; api?: string };
          if (m.model) model = m.model;
          if (m.provider || m.api) provider = m.provider ?? m.api ?? provider;
        }
      } catch {
        // ignore — usage stays partial
      }
    }

    return {
      provider,
      ...(model ? { model } : {}),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {}),
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    };
  }

  async getToolState(_sessionId: string): Promise<EngineToolState> {
    void _sessionId;
    // The tool policy is global per agent in this runtime; read from the
    // adapter's known policy (driven by OPENCLAW_EXEC_MODE at the engine).
    // `available` reflects what a test-mode engine exposes; `denied` reflects
    // the always-denied surface.
    return {
      available: ["exec", "message", "session_status"],
      denied: [
        "write",
        "edit",
        "apply_patch",
        "web_search",
        "web_fetch",
        "browser",
        "gateway",
        "cron",
      ],
    };
  }

  async health(): Promise<EngineHealth> {
    try {
      await this.client.connect();
      const ready = await this.client.request("health", {});
      const healthy = Boolean((ready as { ok?: boolean })?.ok ?? true);
      return {
        healthy,
        ready: healthy,
        provider: "openclaw",
        ...(this.model ? { model: this.model } : {}),
      };
    } catch {
      return { healthy: false, ready: false, provider: "openclaw" };
    }
  }

  /* ------------------------- helpers ------------------------- */

  private resolveModel(model?: string): string | undefined {
    return model ?? this.model;
  }
}

/**
 * OpenClaw's gateway session API accepts a message, not arbitrary provider
 * tool schemas. Keep the adapter boundary provider-neutral by rendering the
 * safe structured context and normalized tool definitions into a strict
 * protocol envelope. Backend authorization remains independent of this text.
 */
function renderOpenClawTurn(input: EngineSendMessageInput): string {
  const sections: string[] = [];
  if (input.nativeBusinessTools) {
    sections.push(
      "DEPARTIFY_NATIVE_BUSINESS_TOOL_MODE (trusted runtime instruction):\n" +
        "The only Departify native business tool available in this experiment is " +
        "departify.company.context. Use it for questions about the company, its current " +
        "objective, or Marketing's current work. The active session determines the tenant; " +
        "never ask for or invent an organization id. Return the tool result in natural language. " +
        "Do not claim provider actions or external mutations.",
    );
  }
  if (input.runtimeContext) {
    sections.push(input.runtimeContext);
  }
  if (input.businessTools && input.businessTools.length > 0) {
    sections.push(
      `DEPARTIFY_BUSINESS_TOOLS_JSON:\n${JSON.stringify(input.businessTools as readonly EngineBusinessToolDefinition[])}`,
    );
  }
  if (input.toolResult) {
    sections.push(input.toolResult);
  }
  sections.push(`MENSAJE DEL CEO:\n${input.message}`);
  return sections.join("\n\n");
}

export function sessionKey(departifyId: string): string {
  return `${SESSION_KEY_PREFIX}${departifyId}`;
}

function normalizeRole(
  role: string | undefined,
): "user" | "assistant" | "system" | "tool" {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
    case "tool":
      return role;
    default:
      return "system";
  }
}

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => {
        if (typeof c === "string") return c;
        const t = (c as { text?: string }).text;
        return typeof t === "string" ? t : undefined;
      })
      .filter((x): x is string => typeof x === "string");
    return parts.join("");
  }
  if (content && typeof content === "object") {
    const t = (content as { text?: string }).text;
    if (typeof t === "string") return t;
  }
  return undefined;
}
