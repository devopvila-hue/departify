import type { ConnectorProvider, ConnectorExecutionResult, ConnectorOperation } from "@departify/connector-runtime";

export type AdsPlatform = "meta" | "tiktok" | "google";
export type AdsCapabilitySuffix =
  | "read"
  | "report"
  | "analyze"
  | "create"
  | "manage"
  | "pause"
  | "resume"
  | "budget.manage"
  | "audience.manage"
  | "creative.manage";
export type AdsBusinessCapability = `marketing.${AdsPlatform}.ads.${AdsCapabilitySuffix}`;

export interface AdsCapabilityDefinition {
  readonly id: AdsBusinessCapability;
  readonly platform: AdsPlatform;
  readonly provider: ConnectorProvider;
  readonly providerToolId: "meta_ads" | "tiktok_ads" | "google_ads";
  readonly sideEffect: boolean;
  readonly requiresOAuth: boolean;
  readonly description: string;
}

const READ: Record<AdsPlatform, { provider: ConnectorProvider; toolId: AdsCapabilityDefinition["providerToolId"] }> = {
  meta: { provider: "meta_ads", toolId: "meta_ads" },
  tiktok: { provider: "tiktok_ads", toolId: "tiktok_ads" },
  google: { provider: "google_ads_mcp", toolId: "google_ads" },
};

function capability(platform: AdsPlatform, suffix: string, sideEffect: boolean, description: string): AdsCapabilityDefinition {
  const base = READ[platform];
  return {
    id: `marketing.${platform}.ads.${suffix}` as AdsBusinessCapability,
    platform,
    provider: base.provider,
    providerToolId: base.toolId,
    sideEffect,
    requiresOAuth: true,
    description,
  };
}

export const ADS_CAPABILITIES: readonly AdsCapabilityDefinition[] = [
  ...(["meta", "tiktok", "google"] as const).flatMap((platform) => [
    capability(platform, "read", false, "Read campaigns and account structure."),
    capability(platform, "report", false, "Read campaign performance and spend."),
    capability(platform, "analyze", false, "Analyze advertising performance."),
    capability(platform, "create", true, "Prepare or create an advertising campaign."),
    capability(platform, "manage", true, "Prepare or manage an advertising resource."),
    capability(platform, "pause", true, "Pause a live advertising resource."),
    capability(platform, "resume", true, "Resume a live advertising resource."),
    capability(platform, "budget.manage", true, "Change an advertising budget."),
    capability(platform, "audience.manage", true, "Change audience targeting."),
    capability(platform, "creative.manage", true, "Change advertising creative."),
  ]),
];

export const ADS_CAPABILITY_MAP: Readonly<Record<string, AdsCapabilityDefinition>> = Object.fromEntries(
  ADS_CAPABILITIES.map((entry) => [entry.id, entry]),
);

export function getAdsCapability(id: string): AdsCapabilityDefinition | null {
  return ADS_CAPABILITY_MAP[id] ?? null;
}

export function isAdsCapability(id: string): boolean {
  return Boolean(ADS_CAPABILITY_MAP[id]);
}

export function credentialRequiredAdsResult(
  requestId: string,
  organizationId: string,
  capability: AdsCapabilityDefinition,
  operation: ConnectorOperation,
  provider: ConnectorProvider = capability.provider,
): ConnectorExecutionResult {
  const now = new Date().toISOString();
  return {
    requestId,
    organizationId,
    provider,
    capability: capability.id,
    operation,
    status: "credential_required",
    error: {
      code: "credential_required",
      message: `${capability.platform === "google" ? "Google Ads" : capability.platform === "meta" ? "Meta Ads" : "TikTok Ads"} needs to be connected before this operation can run.`,
      retryable: false,
    },
    durationMs: 0,
    startedAt: now,
    completedAt: now,
  };
}

export function providerForAdsCapability(capability: AdsCapabilityDefinition, operation: ConnectorOperation): ConnectorProvider {
  if (capability.platform === "google" && operation === "execute" && capability.sideEffect) return "google_ads_api";
  return capability.provider;
}
