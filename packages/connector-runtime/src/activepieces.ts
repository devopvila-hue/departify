import { createHmac } from "node:crypto";
import type {
  ConnectorExecutionError,
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  ConnectorRuntime,
} from "./contracts.js";

export interface ActivepiecesConnectorRuntimeConfig {
  readonly baseUrl: string;
  readonly webhookPaths: Readonly<Record<string, string>>;
  /** Signs tenant-bound webhook requests; it is never sent as a payload field. */
  readonly webhookSigningSecret?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly onEvent?: (event: ActivepiecesRuntimeEvent) => void;
}

export interface ActivepiecesRuntimeEvent {
  readonly event: "started" | "completed" | "failed";
  readonly requestId: string;
  readonly capability: string;
  readonly organizationId: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

const SECRET_KEY_PATTERN = /(authorization|access.?token|refresh.?token|api.?key|client.?secret|password|secret)/i;

/**
 * Activepieces-backed connector runtime.
 *
 * Departify sends only a tenant-bound, capability-bound execution envelope to
 * an Activepieces webhook. Provider credentials live in an Activepieces
 * connection/flow and never cross this boundary into OpenClaw or the model.
 */
export class ActivepiecesConnectorRuntime implements ConnectorRuntime {
  readonly provider = "activepieces" as const;

  private readonly baseUrl: string;
  private readonly webhookPaths: Readonly<Record<string, string>>;
  private readonly webhookSigningSecret: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onEvent: ((event: ActivepiecesRuntimeEvent) => void) | undefined;

  constructor(config: ActivepiecesConnectorRuntimeConfig) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.webhookPaths = config.webhookPaths;
    this.webhookSigningSecret = config.webhookSigningSecret?.trim() || undefined;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.onEvent = config.onEvent;
  }

  async health(signal?: AbortSignal): Promise<ConnectorHealthResult> {
    const started = Date.now();
    if (!this.baseUrl) {
      return {
        provider: "activepieces",
        healthy: false,
        status: 0,
        durationMs: Date.now() - started,
        error: "ACTIVEPIECES_BASE_URL is not configured",
      };
    }
    try {
      const init: RequestInit = { method: "GET" };
      if (signal) init.signal = signal;
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/health`, init);
      return {
        provider: "activepieces",
        healthy: response.ok,
        status: response.status,
        durationMs: Date.now() - started,
        ...(response.ok ? {} : { error: `Activepieces health returned ${response.status}` }),
      };
    } catch (cause) {
      return {
        provider: "activepieces",
        healthy: false,
        status: 0,
        durationMs: Date.now() - started,
        error: cause instanceof Error ? cause.message : "Activepieces health request failed",
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
      const completedAt = new Date().toISOString();
      const output = {
        requestId: request.requestId,
        organizationId: request.organizationId,
        provider: "activepieces" as const,
        capability: request.capability,
        operation: request.operation,
        ...result,
        startedAt,
        completedAt,
        durationMs: Date.now() - started,
      };
      this.onEvent?.({
        event: output.status === "succeeded" || output.status === "prepared" ? "completed" : "failed",
        requestId: request.requestId,
        capability: request.capability,
        organizationId: request.organizationId,
        status: output.status,
        durationMs: output.durationMs,
        ...(output.error ? { errorCode: output.error.code } : {}),
      });
      return output;
    };

    this.onEvent?.({
      event: "started",
      requestId: request.requestId,
      capability: request.capability,
      organizationId: request.organizationId,
    });

    if (!request.requestId || !request.organizationId || !request.capability) {
      return finish({
        status: "failed",
        error: error("invalid_request", "Connector request identity is incomplete.", false),
      });
    }
    if (hasSecretKey(request.input)) {
      return finish({
        status: "failed",
        error: error(
          "secret_payload_rejected",
          "Connector input contains a credential-shaped field.",
          false,
        ),
      });
    }
    if (Object.prototype.hasOwnProperty.call(request.input, "organizationId")) {
      return finish({
        status: "failed",
        error: error("tenant_mismatch", "Connector input cannot override the authenticated tenant.", false),
      });
    }
    if (request.operation === "prepare") {
      return finish({ status: "prepared" });
    }

    const path = this.webhookPaths[request.capability];
    if (!this.baseUrl || !path) {
      return finish({
        status: "not_configured",
        error: error("flow_binding_missing", "No Activepieces flow is bound to this capability.", false),
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const body = JSON.stringify({
      requestId: request.requestId,
      organizationId: request.organizationId,
      capability: request.capability,
      sideEffect: request.sideEffect,
      input: request.input,
    });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-departify-request-id": request.requestId,
      "x-departify-tenant": request.organizationId,
      "x-departify-capability": request.capability,
    };
    if (this.webhookSigningSecret) {
      headers["x-departify-signature"] = createHmac("sha256", this.webhookSigningSecret)
        .update(body)
        .digest("hex");
    }

    try {
      const response = await this.fetchImpl(resolveUrl(this.baseUrl, path), {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const parsed = await parseResponse(response);
      if (!response.ok) {
        return finish({
          status: response.status === 401 || response.status === 403 ? "unauthorized" : "failed",
          error: error(
            response.status === 401 || response.status === 403
              ? "activepieces_http_error"
              : "activepieces_http_error",
            "Activepieces rejected the connector execution.",
            response.status === 408 || response.status === 429 || response.status >= 500,
            response.status,
          ),
        });
      }
      const providerStatus = typeof parsed.status === "string" ? parsed.status.toUpperCase() : "SUCCEEDED";
      if (["FAILED", "ERROR", "TIMEOUT", "CANCELED", "CANCELLED"].includes(providerStatus)) {
        const cancelled = providerStatus === "CANCELED" || providerStatus === "CANCELLED";
        return finish({
          status: providerStatus === "TIMEOUT" ? "timeout" : cancelled ? "cancelled" : "failed",
          ...(typeof parsed.id === "string" ? { providerExecutionId: parsed.id } : {}),
          error: error(
            providerStatus === "TIMEOUT" ? "timeout" : cancelled ? "cancelled" : "activepieces_run_failed",
            "Activepieces reported a failed connector execution.",
            providerStatus === "TIMEOUT" || providerStatus === "FAILED",
          ),
        });
      }
      return finish({
        status: "succeeded",
        ...(typeof parsed.id === "string" ? { providerExecutionId: parsed.id } : {}),
        output: redactSecrets((parsed.output ?? parsed) as TOutput),
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        return finish({
          status: signal?.aborted ? "cancelled" : "timeout",
          error: error(signal?.aborted ? "cancelled" : "timeout", "Activepieces execution timed out.", true),
        });
      }
      return finish({
        status: "failed",
        error: error(
          "activepieces_unreachable",
          cause instanceof Error ? cause.message : "Activepieces execution failed.",
          true,
        ),
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function resolveUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function error(
  code: ConnectorExecutionError["code"],
  message: string,
  retryable: boolean,
  providerStatus?: number,
): ConnectorExecutionError {
  return {
    code,
    message,
    retryable,
    ...(providerStatus === undefined ? {} : { providerStatus }),
  };
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : { output: value };
  } catch {
    return { output: text };
  }
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
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(child);
  }
  return output as T;
}
