import { useCallback, useEffect, useState } from "react";

import { api, type ConnectionCardView, type ToolConnectionView } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

/**
 * Conexiones — Customer Zero 01.
 *
 * Capability-first surface. Five business-language states:
 *   No conectado · Conectando · Conectado · Necesita atención · Error
 *
 * Official brand marks on every card (no fake logos, no remote
 * assets). The "configSource" indicator surfaces "Conectado mediante
 * configuración del sistema" when the connection comes from
 * environment variables (the Customer Zero bootstrap path).
 *
 * The detail view lists the capabilities Elvira can use today and
 * the actions available to the CEO. No raw credentials ever appear
 * in this UI.
 */

const DOMAIN_ORDER = ["crm", "email", "calendar", "documents", "marketing", "team"];

interface ConnectionsPayload {
  organizationId: string;
  connections: ToolConnectionView[];
  cards: ConnectionCardView[];
  unmappedTools: string[];
}

export function ConnectionsRoute() {
  const { organizationId } = useOrg();
  const [cards, setCards] = useState<ConnectionCardView[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = (await api.connections(organizationId)) as ConnectionsPayload | null;
    if (data) {
      setCards(data.cards ?? []);
      setUnmapped(data.unmappedTools ?? []);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(card: ConnectionCardView) {
    if (!organizationId) return;
    setBusy(card.id);
    try {
      // Customer Zero 03 — the card action starts the REAL OAuth handshake.
      // api.connect returns the provider authorization URL; the browser is
      // redirected to Google. After the user authorizes, Google redirects
      // back to the portal callback which completes the handshake server-side.
      const out = await api.connect(organizationId, card.id);
      const authorizationUrl = out?.connection?.authorizationUrl;
      if (authorizationUrl) {
        window.location.href = authorizationUrl;
        return;
      }
      // Non-OAuth tools fall back to a read-only verification.
      await api.testConnection(organizationId, card.id);
    } finally {
      setBusy(null);
      await load();
    }
  }

  const groups = DOMAIN_ORDER.map((domain) => ({
    domain,
    label: DOMAIN_LABELS[domain] ?? domain,
    tools: cards.filter((card) => primaryDomain(card.id) === domain),
  })).filter((group) => group.tools.length > 0);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Conexiones</p>
        <h1>Las herramientas de tu empresa</h1>
        <p className="dfy-hero__lead">
          Elvira solo puede usar las herramientas que tu empresa tiene autorizadas. Cuando
          una conexión está lista, puede trabajar con datos reales sin pedirte credenciales.
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
              {group.tools.map((card) => (
                <ConnectionCardItem
                  key={card.id}
                  card={card}
                  busy={busy === card.id}
                  onAction={() => void runAction(card)}
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

function ConnectionCardItem(props: {
  card: ConnectionCardView;
  busy: boolean;
  onAction: () => void;
}) {
  const { card, busy, onAction } = props;
  return (
    <Card>
      <div className="dfy-connection-card">
        <div
          className="dfy-connection-card__logo"
          style={{ background: card.brandColor }}
          aria-hidden="true"
        >
          <span>{card.logoMark}</span>
        </div>
        <div className="dfy-connection-card__head">
          <strong>{card.name}</strong>
          <Badge tone={toneFor(card.state)}>
            <span className={`dfy-dot dfy-dot--${card.state}`} aria-hidden="true" />{" "}
            {card.stateLabel}
          </Badge>
        </div>
        <p className="dfy-muted dfy-muted--small">{card.category}</p>

        {card.state === "connected" && card.configSource && (
          <p className="dfy-muted dfy-muted--small dfy-connection-card__config">
            Conectado mediante configuración del sistema
          </p>
        )}

        <div className="dfy-connection-card__actions">
          {card.actionLabel && (
            <button
              type="button"
              className="dfy-button dfy-button--small"
              disabled={busy}
              onClick={onAction}
            >
              {busy ? "Comprobando…" : card.actionLabel}
            </button>
          )}
        </div>

        {card.verifiedAt && card.state === "connected" && (
          <p className="dfy-muted dfy-muted--small">
            Verificado por última vez: {fecha(card.verifiedAt)}
          </p>
        )}
      </div>
    </Card>
  );
}

const DOMAIN_LABELS: Record<string, string> = {
  crm: "CRM y automatización",
  email: "Correo",
  calendar: "Calendario",
  documents: "Documentos",
  marketing: "Marketing y publicidad",
  team: "Equipo",
};

const TOOL_DOMAIN: Record<string, string> = {
  mautic: "crm",
  hubspot: "crm",
  gmail: "email",
  google_analytics: "marketing",
  google_ads: "marketing",
  meta_ads: "marketing",
  linkedin_ads: "marketing",
  notion: "documents",
};

function primaryDomain(id: string): string {
  return TOOL_DOMAIN[id] ?? "crm";
}

function toneFor(state: ConnectionCardView["state"]): "neutral" | "success" | "warning" | "danger" {
  switch (state) {
    case "connected":
      return "success";
    case "needs_attention":
      return "warning";
    case "error":
      return "danger";
    case "connecting":
    case "not_connected":
    default:
      return "neutral";
  }
}

function fecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES");
  } catch {
    return iso;
  }
}
