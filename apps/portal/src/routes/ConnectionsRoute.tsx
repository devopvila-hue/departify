import { useCallback, useEffect, useState } from "react";

import { api, type ConnectionCard } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

/**
 * Conexiones — the tools the company works with.
 *
 * Capability-first: the CEO told us which tools he uses and Departify decided
 * internally what to connect. No OAuth client ids, no provider names, no
 * plugin catalog: only "Gmail · Correo · Conectado".
 */
export function ConnectionsRoute() {
  const { organizationId } = useOrg();
  const [connections, setConnections] = useState<ConnectionCard[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.connections(organizationId);
    if (data) {
      setConnections(data.connections ?? []);
      setUnmapped(data.unmappedTools ?? []);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(toolId: string) {
    if (!organizationId) return;
    setBusy(toolId);
    const result = await api.connect(organizationId, toolId);
    setBusy(null);
    if (result?.connection) {
      setConnections((prev) =>
        prev.map((connection) =>
          connection.toolId === toolId ? result.connection : connection,
        ),
      );
      if (result.connection.authorizationUrl) {
        window.open(result.connection.authorizationUrl, "_blank", "noopener");
      }
    }
  }

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Conexiones</p>
        <h1>Las herramientas de tu empresa</h1>
        <p className="dfy-hero__lead">
          Cuantas más conectes, más cosas podrá hacer tu equipo por su cuenta.
        </p>
      </section>

      {connections.length === 0 ? (
        <Card>
          <EmptyState
            title="Sin herramientas todavía"
            description="Cuéntale a tu jefa de Marketing qué usas en el día a día y te ofrecerá conectarlo."
          />
        </Card>
      ) : (
        <div className="dfy-grid">
          {connections.map((connection) => (
            <Card key={connection.toolId}>
              <div className="dfy-work__head">
                <strong>{connection.label}</strong>
                <Badge tone={toneFor(connection.status)}>
                  {labelFor(connection.status)}
                </Badge>
              </div>
              <p className="dfy-muted dfy-muted--small">{connection.category}</p>
              {connection.status !== "connected" && (
                <button
                  type="button"
                  className="dfy-button dfy-button--small"
                  disabled={busy === connection.toolId}
                  onClick={() => void connect(connection.toolId)}
                >
                  {busy === connection.toolId
                    ? "Conectando…"
                    : `Conectar ${connection.label}`}
                </button>
              )}
              {connection.status === "blocked" && (
                <p className="dfy-note">
                  {connection.blockedReason ??
                    "Nos falta un permiso del proveedor para poder conectarlo."}{" "}
                  Nos encargamos nosotros: te avisaremos en cuanto esté listo.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {unmapped.length > 0 && (
        <Card title="Herramientas que usas y todavía no soportamos">
          <p className="dfy-muted">{unmapped.join(", ")}</p>
          <p className="dfy-muted dfy-muted--small">
            Tu equipo lo tiene en cuenta al trabajar, aunque aún no pueda
            entrar en ellas.
          </p>
        </Card>
      )}
    </div>
  );
}

function labelFor(status: ConnectionCard["status"]): string {
  switch (status) {
    case "connected":
      return "Conectado";
    case "connecting":
      return "Conectando";
    case "blocked":
      return "Necesita configuración";
    default:
      return "No conectado";
  }
}

function toneFor(
  status: ConnectionCard["status"],
): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "accent";
    case "blocked":
      return "warning";
    default:
      return "neutral";
  }
}
