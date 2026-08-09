/**
 * Tool lifecycle model — Phase P-B.
 *
 * The ONE authoritative connection lifecycle for a tenant:
 *
 *   SELECTED          CEO declared the company uses the tool.
 *   NEEDS_CONNECTION  Declared, but credentials/authorization are missing.
 *   CONFIGURED        Credentials/configuration exist, verification pending.
 *   CONNECTED         Verification succeeded; connector is operational.
 *   DEGRADED          Previously connected/configured, currently impaired.
 *   UNAVAILABLE       Connector cannot be used right now.
 *
 * INVARIANT: environment-variable presence MUST NEVER mean CONNECTED.
 * CONNECTED requires a successful connector verification (verified_at set).
 * Credential VALUES never live here — only a config source reference.
 */

import type { SupportedLocale } from "./locale.js";

export type ToolLifecycleStatus =
  | "selected"
  | "needs_connection"
  | "configured"
  | "connected"
  | "degraded"
  | "unavailable";

export type ToolHealth = "operational" | "degraded" | "down";

/** The durable, organization-scoped tool/connection record. */
export interface OrganizationToolState {
  readonly organizationId: string;
  readonly toolId: string;
  readonly label: string;
  readonly capability?: string;
  readonly declared: boolean;
  readonly status: ToolLifecycleStatus;
  /** Where configuration originates (e.g. "env:mautic"). Never a secret. */
  readonly configSource?: string;
  readonly verifiedAt?: string;
  readonly health?: ToolHealth;
  readonly updatedAt?: string;
}

/** Framework-independent persistence port (Supabase in production). */
export interface ToolStateStore {
  get(organizationId: string, toolId: string): Promise<OrganizationToolState | null>;
  listForOrg(organizationId: string): Promise<OrganizationToolState[]>;
  upsert(state: OrganizationToolState): Promise<void>;
}

/**
 * Config availability for the Customer Zero bootstrap tools. Only Mautic has a
 * real verification handshake today; others have none (no fake OAuth).
 * Returns a config source label (e.g. "env:mautic") when the required
 * environment variables are present — this is a REFERENCE, never a secret.
 */
export function availableConfigForTool(toolId: string): string | null {
  switch (toolId) {
    case "mautic":
      return hasEnv(["MAUTIC_BASE_URL", "MAUTIC_CLIENT_ID", "MAUTIC_CLIENT_SECRET"])
        ? "env:mautic"
        : null;
    default:
      return null;
  }
}

export function hasEnv(variableNames: readonly string[]): boolean {
  return variableNames.every(
    (name) => {
      const value = process.env[name];
      return typeof value === "string" && value.trim().length > 0;
    },
  );
}

/** Refines a declared tool into its immediate lifecycle status. */
export function refineDeclaredStatus(
  declared: boolean,
  configSource: string | null,
): ToolLifecycleStatus {
  if (!declared) return "unavailable";
  if (configSource) return "configured";
  return "needs_connection";
}

/** Maps the lifecycle onto the legacy handshake status used by the UI. */
export function lifecycleToConnectionStatus(
  lifecycle: ToolLifecycleStatus,
): "not_connected" | "connecting" | "connected" | "blocked" {
  switch (lifecycle) {
    case "connected":
      return "connected";
    case "degraded":
    case "unavailable":
      return "blocked";
    case "configured":
    case "needs_connection":
    case "selected":
      return "not_connected";
  }
}

/** The human status shown to the CEO (no internal jargon). */
export function humanLifecycleLabel(
  status: ToolLifecycleStatus,
  locale: SupportedLocale,
): string {
  const es = locale !== "en";
  switch (status) {
    case "connected":
      return es ? "Conectado" : "Connected";
    case "configured":
      return es ? "Configurado · Verificar conexión" : "Configured · Verify connection";
    case "needs_connection":
    case "selected":
      return es ? "Necesita conexión" : "Needs connection";
    case "degraded":
      return es ? "Problema de conexión" : "Connection problem";
    case "unavailable":
      return es ? "No disponible" : "Unavailable";
  }
}

export function buildDeclaredToolState(
  organizationId: string,
  toolId: string,
  label: string,
  capability: string | undefined,
): OrganizationToolState {
  const configSource = availableConfigForTool(toolId);
  return {
    organizationId,
    toolId,
    label,
    ...(capability ? { capability } : {}),
    declared: true,
    status: refineDeclaredStatus(true, configSource),
    ...(configSource ? { configSource } : {}),
  };
}

/**
 * In-memory store (tests / fallback). A fresh instance per session when no
 * durable store is injected; the SAME instance simulates persistence across
 * "restarts" in the restart-survival test.
 */
export class InMemoryToolStateStore implements ToolStateStore {
  private readonly records = new Map<string, OrganizationToolState>();

  private key(organizationId: string, toolId: string): string {
    return `${organizationId}:${toolId}`;
  }

  async get(
    organizationId: string,
    toolId: string,
  ): Promise<OrganizationToolState | null> {
    return this.records.get(this.key(organizationId, toolId)) ?? null;
  }

  async listForOrg(organizationId: string): Promise<OrganizationToolState[]> {
    return [...this.records.values()].filter(
      (record) => record.organizationId === organizationId,
    );
  }

  async upsert(state: OrganizationToolState): Promise<void> {
    this.records.set(this.key(state.organizationId, state.toolId), {
      ...state,
      updatedAt: state.updatedAt ?? new Date().toISOString(),
    });
  }
}
