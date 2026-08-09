import { useCallback, useEffect, useState } from "react";

import { api, type ToolConnectionView } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

/**
 * Conexiones — the tools the company works with (durable organization state,
 * Phase P-B).
 *
 * Capability-first and honest: SELECTED/CONFIGURED/CONNECTED/DEGRADED are
 * shown in human language. Only real connectors get an actionable button —
 * no fake OAuth for tools without an implementation.
 */
export function ConnectionsRoute() {
  const { organizationId } = useOrg();
  const [connections, setConnections] = useState<ToolConnectionView[]>([]);
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
    await api.connect(organizationId, toolId);
    setBusy(null);
    // The connect/verify action mutates durable state; re-read it.
    await load();
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
            description="Cuéntale a tu jefa de Marketing qué usáis en el día a día y te lo conectará."
          />
        </Card>
      ) : (
        <div className="dfy-grid">
          {connections.map((connection) => (
            <Card key={connection.toolId}>
              <div className="dfy-work__head">
                <strong>{connection.label}</strong>
                <Badge tone={toneFor(connection.status)}>
                  {connection.humanLabel}
                </Badge>
              </div>
              <p className="dfy-muted dfy-muted--small">{connection.category}</p>
              {connection.action && (
                <button
                  type="button"
                  className="dfy-button dfy-button--small"
                  disabled={busy === connection.toolId}
                  onClick={() => void connect(connection.toolId)}
                >
                  {busy === connection.toolId
                    ? "Comprobando…"
                    : actionLabel(connection)}
                </button>
              )}
              {connection.action === null &&
                connection.status !== "connected" && (
                  <p className="dfy-note">
                    Todavía no podemos conectar {connection.label}. Tu equipo lo
                    tiene en cuenta; te avisaremos cuando esté listo.
                  </p>
                )}
              {connection.status === "connected" && connection.verifiedAt && (
                <p className="dfy-note">Verificado {fecha(connection.verifiedAt)}.</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {unmapped.length > 0 && (
        <Card title="También utilizáis estas herramientas">
          <p className="dfy-muted">{unmapped.join(", ")}</p>
          <p className="dfy-muted dfy-muted--small">
            Tu equipo lo tiene en cuenta. Si alguna es razonablemente integrable
            la añadiremos; si no, te diremos qué necesitas sin cambiar de
            CRM por capricho.
          </p>
        </Card>
      )}
    </div>
  );
}

function actionLabel(connection: ToolConnectionView): string {
  switch (connection.action) {
    case "verify":
      return "Verificar conexión";
    case "retry":
      return "Reintentar";
    case "connect":
    default:
      return `Conectar ${connection.label}`;
  }
}

function fecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES");
  } catch {
    return iso;
  }
}

function toneFor(
  status: ToolConnectionView["status"],
): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (status) {
    case "connected":
      return "success";
    case "configured":
      return "accent";
    case "degraded":
    case "unavailable":
      return "danger";
    case "needs_connection":
    case "selected":
      return "warning";
  }
}
