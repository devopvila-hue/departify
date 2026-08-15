import {
  ActivepiecesConnectorRuntime,
  type ActivepiecesConnectorRuntimeConfig,
  type ActivepiecesRuntimeEvent,
  type ConnectorExecutionError,
  type ConnectorExecutionResult,
  type ConnectorOperation,
  type ConnectorRuntime,
  McpConnectorRuntime,
  GoogleAdsApiRuntime,
  type ConnectorRuntimeCandidate,
} from "@departify/connector-runtime";
import { ADS_CAPABILITIES } from "./ads-capabilities.js";
import { getExternalOAuthTokenStore } from "./external-oauth-tokens.js";

export interface ConnectorCapabilityDefinition {
  readonly id: string;
  readonly providerToolId: "meta_business";
  readonly sideEffect: boolean;
  readonly requiresOAuth: true;
}

export const ACTIVEPIECES_CONNECTOR_CAPABILITIES: Readonly<Record<string, ConnectorCapabilityDefinition>> = {
  "marketing.social.publish": {
    id: "marketing.social.publish",
    providerToolId: "meta_business",
    sideEffect: true,
    requiresOAuth: true,
  },
  "marketing.meta.ads.read": {
    id: "marketing.meta.ads.read",
    providerToolId: "meta_business",
    sideEffect: false,
    requiresOAuth: true,
  },
  "marketing.meta.ads.manage": {
    id: "marketing.meta.ads.manage",
    providerToolId: "meta_business",
    sideEffect: true,
    requiresOAuth: true,
  },
};

export function getConnectorCapability(capability: string): ConnectorCapabilityDefinition | null {
  return ACTIVEPIECES_CONNECTOR_CAPABILITIES[capability] ?? null;
}

export function createActivepiecesConnectorRuntime(
  onEvent?: (event: ActivepiecesRuntimeEvent) => void,
): ConnectorRuntime {
  const baseUrl = process.env.ACTIVEPIECES_BASE_URL?.trim() ?? "";
  const webhookSecret = process.env.ACTIVEPIECES_WEBHOOK_SIGNING_SECRET?.trim() ?? "";
  const metaWebhookPath = process.env.ACTIVEPIECES_META_ADS_WEBHOOK_PATH?.trim() ?? "";
  const socialWebhookPath = process.env.ACTIVEPIECES_META_SOCIAL_PUBLISH_WEBHOOK_PATH?.trim() ?? "";
  const config: ActivepiecesConnectorRuntimeConfig = {
    baseUrl,
    webhookPaths: {
      ...(socialWebhookPath
        ? { "marketing.social.publish": socialWebhookPath }
        : {}),
      ...(metaWebhookPath
        ? {
            "marketing.meta.ads.read": metaWebhookPath,
            "marketing.meta.ads.manage": metaWebhookPath,
          }
        : {}),
    },
    timeoutMs: Number(process.env.ACTIVEPIECES_CONNECTOR_TIMEOUT_MS ?? 30_000),
    ...(webhookSecret ? { webhookSigningSecret: webhookSecret } : {}),
    ...(onEvent ? { onEvent } : {}),
  };
  return new ActivepiecesConnectorRuntime(config);
}

/**
 * Compose the configured official MCP runtimes with the existing Community
 * runtime. Empty MCP endpoint variables mean "not configured", not healthy or
 * connected. Provider selection happens later per capability and tenant.
 */
export function createConnectorRuntimeCandidates(
  onEvent?: (event: ActivepiecesRuntimeEvent) => void,
): ConnectorRuntimeCandidate[] {
  const candidates: ConnectorRuntimeCandidate[] = [];
  const addMcp = (
    provider: "meta_ads" | "tiktok_ads" | "google_ads_mcp",
    endpoint: string | undefined,
    capabilities: readonly string[],
    hints: Readonly<Record<string, readonly string[]>>,
  ) => {
    if (!endpoint?.trim()) return;
    const runtimeConfig = {
      provider,
      endpoint,
      capabilityToolHints: hints,
      ...(provider === "meta_ads"
        ? {
            authHeaders: async (context: Pick<import("@departify/connector-runtime").ConnectorExecutionRequest, "organizationId" | "userId" | "capability">) => {
              const record = await getExternalOAuthTokenStore().get(
                context.organizationId,
                context.userId ?? "system",
                "meta_business",
              );
              return record?.accessToken ? { authorization: `Bearer ${record.accessToken}` } : {};
            },
          }
        : {}),
      ...(onEvent
        ? { onEvent: (event: import("@departify/connector-runtime").McpRuntimeEvent) => onEvent({
            event: event.event === "discovered" ? "completed" : event.event,
            requestId: event.requestId ?? "provider-probe",
            capability: event.capability ?? "provider.health",
            organizationId: event.organizationId ?? "system",
            ...(event.status ? { status: event.status } : {}),
            ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
            ...(event.errorCode ? { errorCode: event.errorCode } : {}),
          }) }
        : {}),
    } satisfies import("@departify/connector-runtime").McpConnectorRuntimeConfig;
    const runtime = new McpConnectorRuntime(runtimeConfig);
    candidates.push({
      provider,
      kind: "official_mcp",
      capabilities,
      runtime,
    });
  };
  const byProvider = (provider: "meta_ads" | "tiktok_ads" | "google_ads_mcp", readOnly = false) =>
    ADS_CAPABILITIES.filter((entry) => entry.provider === provider && (!readOnly || !entry.sideEffect)).map((entry) => entry.id);
  addMcp("meta_ads", process.env.META_ADS_MCP_ENDPOINT, byProvider("meta_ads"), {});
  addMcp("tiktok_ads", process.env.TIKTOK_ADS_MCP_ENDPOINT, byProvider("tiktok_ads"), {});
  addMcp("google_ads_mcp", process.env.GOOGLE_ADS_MCP_ENDPOINT, byProvider("google_ads_mcp", true), {});

  const googleApiConfigured = [
    process.env.GOOGLE_ADS_ACCESS_TOKEN,
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    process.env.GOOGLE_ADS_CUSTOMER_ID,
  ].every((value) => Boolean(value?.trim()));
  if (googleApiConfigured) {
    const runtime = new GoogleAdsApiRuntime({
      accessToken: () => process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim() ?? "",
      developerToken: () => process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? "",
      customerId: () => process.env.GOOGLE_ADS_CUSTOMER_ID?.trim() ?? "",
      ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim()
        ? { loginCustomerId: () => process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() ?? "" }
        : {}),
    });
    candidates.push({
      provider: "google_ads_api",
      kind: "official_api",
      capabilities: ADS_CAPABILITIES.filter((entry) => entry.platform === "google" && entry.sideEffect).map((entry) => entry.id),
      runtime,
    });
  }

  const activepieces = createActivepiecesConnectorRuntime(onEvent);
  candidates.push({
    provider: "activepieces",
    kind: "activepieces_community",
    capabilities: [
      "marketing.social.publish",
      "marketing.meta.ads.read",
      "marketing.meta.ads.manage",
    ],
    runtime: activepieces,
  });
  return candidates;
}

export function credentialRequiredResult(
  requestId: string,
  organizationId: string,
  capability: ConnectorCapabilityDefinition,
  operation: ConnectorOperation,
): ConnectorExecutionResult {
  const now = new Date().toISOString();
  const error: ConnectorExecutionError = {
    code: "credential_required",
    message: "Meta OAuth must be completed before this connector can execute.",
    retryable: false,
  };
  return {
    requestId,
    organizationId,
    provider: "activepieces",
    capability: capability.id,
    operation,
    status: "credential_required",
    error,
    durationMs: 0,
    startedAt: now,
    completedAt: now,
  };
}
