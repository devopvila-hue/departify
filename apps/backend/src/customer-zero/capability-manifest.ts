/**
 * Runtime capability manifest.
 *
 * This is a business-facing projection of the canonical connection state. It
 * deliberately contains no provider credentials, OAuth scopes, headers or
 * implementation details. A capability is available only when the supplied
 * connection projection says that the provider is operational.
 */

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
    toolId: string;
    label: string;
    capabilities: readonly string[];
  }[];
}

interface CapabilityRule {
  readonly id: string;
  readonly sourceCapabilities: readonly string[];
  readonly alwaysAvailable?: boolean;
}

/** The smallest normalized surface required by Customer Zero today. */
export const RUNTIME_CAPABILITY_RULES: readonly CapabilityRule[] = [
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
  { id: "calendar.list", sourceCapabilities: ["calendar.read"] },
  { id: "calendar.create", sourceCapabilities: ["calendar.create"] },
  { id: "drive.search", sourceCapabilities: ["drive.search"] },
  { id: "drive.read", sourceCapabilities: ["drive.read"] },
  { id: "tasks.list", sourceCapabilities: [], alwaysAvailable: true },
  { id: "tasks.create", sourceCapabilities: [], alwaysAvailable: true },
  { id: "approvals.list", sourceCapabilities: [], alwaysAvailable: true },
  { id: "results.list", sourceCapabilities: [], alwaysAvailable: true },
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
      toolId: connection.toolId,
      label: connection.label,
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
        providers.add(connection.label);
      }
    }
    const available = providers.size > 0;
    return {
      id: rule.id,
      available,
      providers: [...providers],
      ...(available ? {} : { reason: "not_connected" as const }),
    } satisfies RuntimeCapability;
  });

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

