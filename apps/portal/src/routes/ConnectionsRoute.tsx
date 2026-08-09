import { useCallback, useEffect, useState } from "react";

import { api, type ToolConnectionView } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

/**
 * Conexiones — the company's capability/tool catalog + durable state
 * (Phase P-B production fix).
 *
 * The catalog is the permanent surface: tools declared during onboarding,
 * configured/connected tools, AND relevant available tools that can be added
 * later. "Not selected during onboarding" never means "absent forever".
 *
 * Honest by construction: only real actions are offered. Mautic can be
 * verified/connected; everything else can only be prepared (declared) —
 * never a fake OAuth button.
 */

const DOMAIN_LABELS: Record<string, string> = {
  crm: "CRM",
  email: "Correo",
  calendar: "Calendario",
  documents: "Documentos",
  marketing: "Marketing",
  team: "Equipo",
};

const DOMAIN_ORDER = ["crm", "email", "calendar", "documents", "marketing", "team"];

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

  async function runAction(tool: ToolConnectionView) {
    if (!organizationId) return;
    setBusy(tool.toolId);
    if (tool.action === "prepare") {
      await api.declareTool(organizationId, tool.toolId);
    } else {
      await api.connect(organizationId, tool.toolId);
    }
    setBusy(null);
    await load();
  }

  const primaryDomain = (tool: ToolConnectionView): string =>
    tool.domains[0] ?? "crm";

  const groups = DOMAIN_ORDER.map((domain) => ({
    domain,
    label: DOMAIN_LABELS[domain] ?? domain,
    tools: connections.filter((tool) => primaryDomain(tool) === domain),
  })).filter((group) => group.tools.length > 0);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Conexiones</p>
        <h1>Las herramientas de tu empresa</h1>
        <p className="dfy-hero__lead">
          Tu catálogo de capacidades. Selecciona las que usa la empresa y
          conecta las que Departify puede operar.
        </p>
      </section>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="Sin herramientas todavía"
            description="El catálogo se está preparando. Vuelve en un momento."
          />
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.domain} className="dfy-catalog-group">
            <h2 className="dfy-catalog-group__title">{group.label}</h2>
            <div className="dfy-grid">
              {group.tools.map((connection) => (
                <ToolCard
                  key={connection.toolId}
                  connection={connection}
                  busy={busy === connection.toolId}
                  onAction={() => void runAction(connection)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {unmapped.length > 0 && (
        <Card title="También utilizáis estas herramientas">
          <p className="dfy-muted">{unmapped.join(", ")}</p>
          <p className="dfy-muted dfy-muted--small">
            Tu equipo lo tiene en cuenta. Si alguna es razonablemente integrable
            la añadiremos al catálogo.
          </p>
        </Card>
      )}
    </div>
  );
}

function ToolCard(props: {
  connection: ToolConnectionView;
  busy: boolean;
  onAction: () => void;
}) {
  const { connection } = props;
  const secondaryDomains = connection.domains.slice(1);
  return (
    <Card>
      <div className="dfy-work__head">
        <strong>{connection.label}</strong>
        <Badge tone={toneFor(connection)}>{connection.humanLabel}</Badge>
      </div>
      <p className="dfy-muted dfy-muted--small">
        {connection.category}
        {secondaryDomains.length > 0 &&
          ` · También: ${secondaryDomains
            .map((domain) => DOMAIN_LABELS[domain] ?? domain)
            .join(", ")}`}
      </p>

      {props.connection.action && (
        <button
          type="button"
          className="dfy-button dfy-button--small"
          disabled={props.busy}
          onClick={props.onAction}
        >
          {props.busy ? "Comprobando…" : actionLabel(props.connection)}
        </button>
      )}

      {props.connection.action === null && connection.state !== "available" && (
        <p className="dfy-note">
          {connection.state === "needs_connection" ||
          connection.state === "selected"
            ? "Seleccionada. La conexión estará disponible pronto."
            : "Todavía no podemos operar esta herramienta."}
        </p>
      )}
      {connection.state === "available" && (
        <p className="dfy-note">
          Disponible para añadir a la empresa. Al seleccionarla la guardamos y
          podremos preparar el acceso cuando esté listo.
        </p>
      )}
      {connection.state === "connected" && connection.verifiedAt && (
        <p className="dfy-note">Verificado {fecha(connection.verifiedAt)}.</p>
      )}
    </Card>
  );
}

function actionLabel(connection: ToolConnectionView): string {
  switch (connection.action) {
    case "prepare":
      return "Preparar conexión";
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
  connection: ToolConnectionView,
): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (connection.state) {
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
    case "available":
    default:
      return "neutral";
  }
}
