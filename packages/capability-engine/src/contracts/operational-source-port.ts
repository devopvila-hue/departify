/**
 * Operational Source Port — Sprint 62.
 *
 * The ONLY place the Department Capability Registry learns whether a
 * capability is really available. It is deliberately a narrow port:
 *
 *   - connection status (operational state, from the Connection Registry)
 *   - tool availability (registered + active in the Tool Runtime)
 *
 * Conversational memory NEVER flows through this port. The whole point of the
 * port is that "Mautic connected = operational truth" and "MOON prefers weekly
 * newsletters = memory" can never be confused by the Department Head.
 */

export type OperationalConnectionStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "blocked";

export interface OperationalConnectionState {
  readonly toolId: string;
  readonly status: OperationalConnectionStatus;
  /** Credential variable NAMES that are missing (never values). */
  readonly missingCredentials?: readonly string[];
}

export interface OperationalSourcePort {
  /** Connection state by tool id (Connection Registry truth). */
  connection(toolId: string): OperationalConnectionState | null;
  /** Whether a Tool Runtime tool id is registered and active. */
  isToolAvailable(toolId: string): boolean;
  /** List of every connection the host knows about (for the registry view). */
  listConnections(): readonly OperationalConnectionState[];
}
