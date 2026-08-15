export type ConnectorOperation = "prepare" | "execute";

/** Execution providers are implementation details; they never cross into the CEO UI. */
export type ConnectorProvider =
  | "activepieces"
  | "meta_ads"
  | "tiktok_ads"
  | "google_ads_mcp"
  | "google_ads_api";

export type ConnectorExecutionStatus =
  | "succeeded"
  | "prepared"
  | "not_configured"
  | "credential_required"
  | "unauthorized"
  | "failed"
  | "timeout"
  | "cancelled";

export type ConnectorErrorCode =
  | "invalid_request"
  | "flow_binding_missing"
  | "activepieces_unreachable"
  | "activepieces_http_error"
  | "activepieces_run_failed"
  | "credential_required"
  | "unauthorized"
  | "tenant_mismatch"
  | "timeout"
  | "cancelled"
  | "secret_payload_rejected"
  | "provider_unavailable"
  | "mcp_transport_error"
  | "mcp_protocol_error"
  | "mcp_tool_unavailable"
  | "schema_drift"
  | "invalid_response"
  | "approval_required"
  | "account_mismatch";

export interface ConnectorExecutionRequest {
  readonly requestId: string;
  readonly organizationId: string;
  /** Internal authenticated user reference; never accepted from request input. */
  readonly userId?: string;
  readonly capability: string;
  readonly operation: ConnectorOperation;
  readonly input: Readonly<Record<string, unknown>>;
  readonly sideEffect: boolean;
}

export interface ConnectorExecutionError {
  readonly code: ConnectorErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerStatus?: number;
}

export interface ConnectorExecutionResult<TOutput = unknown> {
  readonly requestId: string;
  readonly organizationId: string;
  readonly provider: ConnectorProvider;
  readonly capability: string;
  readonly operation: ConnectorOperation;
  readonly status: ConnectorExecutionStatus;
  readonly output?: TOutput;
  readonly providerExecutionId?: string;
  readonly error?: ConnectorExecutionError;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface ConnectorRuntime {
  readonly provider: ConnectorProvider;
  execute<TOutput = unknown>(
    request: ConnectorExecutionRequest,
    signal?: AbortSignal,
  ): Promise<ConnectorExecutionResult<TOutput>>;
  health(signal?: AbortSignal): Promise<ConnectorHealthResult>;
}

export interface ConnectorHealthResult {
  readonly provider: ConnectorProvider;
  readonly healthy: boolean;
  readonly status: number;
  readonly durationMs: number;
  readonly error?: string;
}
