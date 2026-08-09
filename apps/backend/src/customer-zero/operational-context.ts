/**
 * Operational Context for the session — Sprint 62.
 *
 * Builds the canonical Operational Context that department reasoning receives
 * BEFORE the LLM ever speaks. The operational source is wired to the session's
 * REAL connection registry (session.state.connections) and the session's REAL
 * Tool Runtime (session.runtime.registry). Memory never participates here, so
 * the LLM cannot invent connection state and memory cannot mask unavailability.
 */
import {
  buildMauticCapability,
  buildOperationalContext,
  certifyMauticCapability,
  type OperationalConnectionState,
  type OperationalSourcePort,
} from "@departify/capability-engine";
import { getMarketingHead } from "./department-identity.js";
import type { CustomerZeroSession } from "./customer-zero-session.js";
import { listDepartmentMemory } from "./department-memory.js";

export function buildOperationalSourcePort(
  session: CustomerZeroSession,
): OperationalSourcePort {
  const connections = [...session.state.connections.values()];
  return {
    connection(toolId) {
      const found = connections.find((connection) => connection.toolId === toolId);
      if (!found) return null;
      const state: OperationalConnectionState = {
        toolId: found.toolId,
        status: found.status,
        ...(found.missingCredentials && found.missingCredentials.length > 0
          ? { missingCredentials: found.missingCredentials }
          : {}),
      };
      return state;
    },
    isToolAvailable(toolId) {
      const tool = session.runtime.registry.get(toolId);
      return Boolean(tool);
    },
    listConnections() {
      return connections.map((connection) => ({
        toolId: connection.toolId,
        status: connection.status,
      }));
    },
  };
}

/**
 * The canonical operational context for the session's Marketing department.
 * The Mautic capability is certified (verification passed) only when the real
 * connection is established; otherwise it stays pending/unavailable and can
 * never present as READY.
 */
export function buildSessionOperationalContext(
  session: CustomerZeroSession,
): ReturnType<typeof buildOperationalContext> {
  const source = buildOperationalSourcePort(session);

  // Certify Mautic deterministically from the REAL connection state. The
  // certification date is only meaningful when the connection exists; the
  // registry still refuses READY until the source reports connected.
  const mautic = session.state.connections.get("mautic");
  const certifiedMautic = certifyMauticCapability(
    session.capabilities.get("mautic") ?? buildMauticCapability(),
    mautic?.status === "connected"
      ? mautic.connectedAt ?? new Date().toISOString()
      : new Date().toISOString(),
  );
  session.capabilities.register(certifiedMautic);

  const derived = session.capabilities.deriveForDepartment("marketing", source);

  const work = session.state.marketingWork;
  const head = getMarketingHead();

  const context = buildOperationalContext({
    company: {
      name: session.state.companyName ?? session.state.onboarding?.companyName ?? "Tu empresa",
      ...(session.state.onboarding?.goal ? { goal: session.state.onboarding.goal } : {}),
    },
    departments: [
      {
        id: "marketing",
        name: "Marketing",
        head: head.name,
        status: "active",
      },
    ],
    connections: source.listConnections(),
    capabilities: derived,
    activeTasks: (work?.items ?? [])
      .filter((item) => ["pending", "running", "approved"].includes(item.status))
      .map((item) => ({ id: item.id, title: item.title, status: item.status })),
    pendingApprovals: (work?.items ?? [])
      .filter((item) => item.status === "needs_approval")
      .map((item) => ({ id: item.id, title: item.title, status: item.status })),
    recentToolResults: (work?.items ?? [])
      .filter((item) => item.status === "completed" && item.result)
      .map((item) => ({
        toolId: item.capability ?? "marketing",
        ok: true,
        summary: item.result ?? "",
      })),
    departmentMemory: listDepartmentMemory(session, "marketing", { limit: 5 }).map(
      (memory) => ({
        id: memory.id,
        title: memory.title,
        content: memory.content,
        provenance: memory.provenance,
      }),
    ),
  });

  // Phase P-B — the chat must distinguish DECLARED / CONFIGURED / CONNECTED /
  // DEGRADED. This block complements the package's connected-systems line.
  return {
    ...context,
    promptView: context.promptView + buildToolLifecycleBlock(session),
  };
}

/** Human lifecycle block for every declared/configured/connected tool. */
function buildToolLifecycleBlock(session: CustomerZeroSession): string {
  const entries = [...session.state.connections.values()]
    .map((connection) => {
      const lifecycle = lifecycleLabel(connection);
      if (!lifecycle) return null;
      return `  - ${connection.label}: ${lifecycle}`;
    })
    .filter((line): line is string => line !== null);
  if (entries.length === 0) return "";
  return `\nESTADO DE LAS HERRAMIENTAS:\n${entries.join("\n")}`;
}

function lifecycleLabel(connection: {
  lifecycle?: string;
  status?: string;
  verifiedAt?: string;
}): string | null {
  const lifecycle = connection.lifecycle ?? connection.status;
  if (!lifecycle) return null;
  switch (lifecycle) {
    case "connected":
      return "CONECTADA" + (connection.verifiedAt ? ` (verificada ${connection.verifiedAt})` : "");
    case "configured":
      return "CONFIGURADA — credenciales presentes, verificación pendiente";
    case "needs_connection":
      return "SELECCIONADA — necesita conexión";
    case "selected":
      return "SELECCIONADA";
    case "degraded":
      return "DEGRADADA — problema de conexión";
    case "unavailable":
      return "NO DISPONIBLE";
    default:
      return lifecycle;
  }
}
