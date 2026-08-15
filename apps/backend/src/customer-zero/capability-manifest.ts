/**
 * Runtime capability manifest.
 *
 * This is a business-facing projection of the canonical connection state. It
 * deliberately contains no provider credentials, OAuth scopes, headers or
 * implementation details. A capability is available only when the supplied
 * connection projection says that the provider is operational.
 */

import { ADS_CAPABILITIES, isAdsCapability } from "./ads-capabilities.js";

export type CapabilityAvailability = "available" | "unavailable";

export interface CapabilityConnectionSource {
  readonly toolId: string;
  readonly label: string;
  readonly state: string;
  /** Capabilities verified by the connection probe, when known. */
  readonly capabilities?: readonly string[];
}

export interface RuntimeCapability {
  readonly id: string;
  readonly available: boolean;
  readonly providers: readonly string[];
  readonly reason?: "not_connected" | "not_verified" | "unsupported";
}

export interface RuntimeCapabilityManifest {
  readonly version: 1;
  readonly generatedAt: string;
  readonly capabilities: readonly RuntimeCapability[];
  readonly connectedTools: readonly {
    readonly tool: string;
    capabilities: readonly string[];
  }[];
}

interface CapabilityRule {
  readonly id: string;
  readonly sourceCapabilities: readonly string[];
  readonly alwaysAvailable?: boolean;
  readonly unsupported?: boolean;
}

/** Keep provider-facing catalog labels out of the CEO's runtime vocabulary. */
export function businessSafeConnectionLabel(toolId: string, label: string): string {
  if (toolId === "meta_business") return "Facebook Pages";
  return label;
}

function businessConnectionLabel(connection: CapabilityConnectionSource): string {
  return businessSafeConnectionLabel(connection.toolId, connection.label);
}

/** The smallest normalized surface required by Customer Zero today. */
export const RUNTIME_CAPABILITY_RULES: readonly CapabilityRule[] = [
  ...ADS_CAPABILITIES.map((capability) => ({
    id: capability.id,
    sourceCapabilities: [capability.id],
  })),
  {
    id: "email.business.read",
    sourceCapabilities: ["email.read", "email.thread.read"],
  },
  {
    id: "email.business.search",
    sourceCapabilities: ["email.search", "email.read"],
  },
  {
    id: "email.business.send",
    sourceCapabilities: ["email.send", "email.send.personal"],
  },
  {
    id: "email.business.reply",
    sourceCapabilities: ["email.reply", "email.send.personal"],
  },
  {
    id: "marketing.social.read",
    sourceCapabilities: ["marketing.social.read"],
  },
  {
    id: "marketing.social.publish",
    sourceCapabilities: ["marketing.social.publish"],
  },
  { id: "calendar.list", sourceCapabilities: ["calendar.read"] },
  { id: "calendar.create", sourceCapabilities: ["calendar.create"] },
  { id: "drive.search", sourceCapabilities: ["drive.search"] },
  { id: "drive.read", sourceCapabilities: ["drive.read"] },
  { id: "drive.write", sourceCapabilities: [], unsupported: true },
  { id: "tasks.list", sourceCapabilities: [], alwaysAvailable: true },
  { id: "tasks.create", sourceCapabilities: [], alwaysAvailable: true },
  { id: "approvals.list", sourceCapabilities: [], alwaysAvailable: true },
  { id: "results.list", sourceCapabilities: [], alwaysAvailable: true },
  {
    id: "work.deliverable",
    sourceCapabilities: ["crm.contacts.list", "crm.contacts.read", "crm.contacts.summary"],
  },
  { id: "company.context", sourceCapabilities: [], alwaysAvailable: true },
];

function sourceCapabilities(
  source: CapabilityConnectionSource,
): readonly string[] {
  if (source.capabilities) return source.capabilities;
  return source.state === "connected" ? [] : [];
}

/** Build the manifest from the current canonical connection projection. */
export function buildRuntimeCapabilityManifest(
  connections: readonly CapabilityConnectionSource[],
  generatedAt = new Date().toISOString(),
): RuntimeCapabilityManifest {
  const connectedTools = connections
    .filter((connection) => connection.state === "connected")
    .map((connection) => ({
      tool: businessConnectionLabel(connection),
      capabilities: [...sourceCapabilities(connection)],
    }));

  const capabilities = RUNTIME_CAPABILITY_RULES.map((rule) => {
    if (rule.alwaysAvailable) {
      return {
        id: rule.id,
        available: true,
        providers: ["departify"],
      } satisfies RuntimeCapability;
    }

    const providers = new Set<string>();
    for (const connection of connections) {
      if (connection.state !== "connected") continue;
      const actual = sourceCapabilities(connection);
      if (rule.sourceCapabilities.some((candidate) => actual.includes(candidate))) {
        providers.add(businessConnectionLabel(connection));
      }
    }
    const available = providers.size > 0;
    const hasConnectedSource = connections.some(
      (connection) => connection.state === "connected",
    );
    return {
      id: rule.id,
      available,
      providers: [...providers],
      ...(available
        ? {}
        : {
            reason: rule.unsupported
              ? ("unsupported" as const)
              : hasConnectedSource
                ? ("not_verified" as const)
                : ("not_connected" as const),
          }),
    } satisfies RuntimeCapability;
  }).filter((capability) => !isAdsCapability(capability.id) || capability.available);

  return {
    version: 1,
    generatedAt,
    capabilities,
    connectedTools,
  };
}

export function isRuntimeCapabilityAvailable(
  manifest: RuntimeCapabilityManifest,
  capability: string,
): boolean {
  return manifest.capabilities.some(
    (entry) => entry.id === capability && entry.available,
  );
}
