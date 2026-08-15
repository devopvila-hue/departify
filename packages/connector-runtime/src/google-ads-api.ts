import type {
  ConnectorExecutionError,
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  ConnectorRuntime,
} from "./contracts.js";

export interface GoogleAdsApiRuntimeConfig {
  readonly apiVersion?: string;
  readonly accessToken: () => Promise<string> | string;
  readonly developerToken: () => Promise<string> | string;
  /** Resolved from the canonical connected account, never from request input. */
  readonly customerId: () => Promise<string> | string;
  readonly loginCustomerId?: () => Promise<string> | string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly onEvent?: (event: GoogleAdsApiRuntimeEvent) => void;
}

export interface GoogleAdsApiRuntimeEvent {
  readonly event: "started" | "completed" | "failed";
  readonly requestId: string;
  readonly organizationId: string;
  readonly capability: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

/**
 * Official Google Ads API mutation path. Google Ads MCP remains a separate,
 * read-only runtime. This adapter accepts the provider's documented
 * `mutateOperations` payload but owns customer/account and secret resolution.
 */
export class GoogleAdsApiRuntime implements ConnectorRuntime {
  readonly provider = "google_ads_api" as const;
  private readonly apiVersion: string;
  private readonly accessToken: GoogleAdsApiRuntimeConfig["accessToken"];
  private readonly developerToken: GoogleAdsApiRuntimeConfig["developerToken"];
  private readonly customerId: GoogleAdsApiRuntimeConfig["customerId"];
  private readonly loginCustomerId?: GoogleAdsApiRuntimeConfig["loginCustomerId"];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onEvent: ((event: GoogleAdsApiRuntimeEvent) => void) | undefined;

  constructor(config: GoogleAdsApiRuntimeConfig) {
    this.apiVersion = config.apiVersion ?? "v25";
    this.accessToken = config.accessToken;
    this.developerToken = config.developerToken;
    this.customerId = config.customerId;
    this.loginCustomerId = config.loginCustomerId;
    this.baseUrl = (config.baseUrl ?? "https://googleads.googleapis.com").replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.onEvent = config.onEvent;
  }

  async health(signal?: AbortSignal): Promise<ConnectorHealthResult> {
    const started = Date.now();
    try {
      const response = await this.request("customers:listAccessibleCustomers", undefined, signal);
      return { provider: this.provider, healthy: response.ok, status: response.status, durationMs: Date.now() - started, ...(response.ok ? {} : { error: "Google Ads is not available." }) };
    } catch {
      return { provider: this.provider, healthy: false, status: 0, durationMs: Date.now() - started, error: "Google Ads is not available." };
    }
  }

  async execute<TOutput = unknown>(request: ConnectorExecutionRequest, signal?: AbortSignal): Promise<ConnectorExecutionResult<TOutput>> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const finish = (result: Omit<ConnectorExecutionResult<TOutput>, "requestId" | "organizationId" | "provider" | "capability" | "operation" | "startedAt" | "completedAt" | "durationMs">): ConnectorExecutionResult<TOutput> => {
      const output = { requestId: request.requestId, organizationId: request.organizationId, provider: this.provider, capability: request.capability, operation: request.operation, ...result, startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started };
      this.onEvent?.({ event: output.status === "succeeded" || output.status === "prepared" ? "completed" : "failed", requestId: request.requestId, organizationId: request.organizationId, capability: request.capability, status: output.status, durationMs: output.durationMs, ...(output.error ? { errorCode: output.error.code } : {}) });
      return output;
    };
    this.onEvent?.({ event: "started", requestId: request.requestId, organizationId: request.organizationId, capability: request.capability });
    if (!request.requestId || !request.organizationId || !request.capability) return finish({ status: "failed", error: error("invalid_request", "The request could not be validated.", false) });
    if (hasForbiddenInput(request.input)) return finish({ status: "failed", error: error("secret_payload_rejected", "The request contains an account or credential override.", false) });
    if (request.operation === "prepare") return finish({ status: "prepared" });
    if (!request.sideEffect) return finish({ status: "not_configured", error: error("provider_unavailable", "Google Ads read operations use the connected reporting path.", false) });
    const operations = request.input.mutateOperations;
    if (!Array.isArray(operations) || operations.length === 0) return finish({ status: "failed", error: error("invalid_response", "The approved Google Ads change is missing its operation payload.", false) });
    try {
      const customerId = await this.customerId();
      const response = await this.request(`customers/${encodeURIComponent(customerId)}:mutate`, { mutateOperations: operations }, signal);
      const body = await safeJson(response);
      if (!response.ok) {
        const unauthorized = response.status === 401 || response.status === 403;
        return finish({ status: unauthorized ? "unauthorized" : "failed", error: error(unauthorized ? "unauthorized" : "provider_unavailable", unauthorized ? "Google Ads needs to be reconnected." : "Google Ads could not apply the approved change.", response.status >= 500 || response.status === 429) });
      }
      return finish({ status: "succeeded", output: body as TOutput });
    } catch {
      return finish({ status: "timeout", error: error("timeout", "The Google Ads operation timed out. You can verify the result before retrying.", true) });
    }
  }

  private async request(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const [accessToken, developerToken] = await Promise.all([this.accessToken(), this.developerToken()]);
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "content-type": "application/json",
      };
      const loginCustomerId = this.loginCustomerId ? await this.loginCustomerId() : "";
      if (loginCustomerId) headers["login-customer-id"] = loginCustomerId.replace(/-/g, "");
      return await this.fetchImpl(`${this.baseUrl}/${this.apiVersion}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return {}; }
}

function hasForbiddenInput(input: Readonly<Record<string, unknown>>): boolean {
  return ["organizationId", "tenantId", "providerAccountId", "customerId", "loginCustomerId", "developerToken", "accessToken", "refreshToken", "credentialReference"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function error(code: ConnectorExecutionError["code"], message: string, retryable: boolean): ConnectorExecutionError { return { code, message, retryable }; }
