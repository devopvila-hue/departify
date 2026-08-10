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

const DOMAIN_ORDER = ["crm", "email", "calendar", "documents", "marketing", "team", "other"];

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

  // P0 — group by backend-provided `categoryId` so the portal never
  // maintains a duplicate, incomplete, locale-coupled tool-to-domain map.
  // The backend is the single source of truth for connection identity.
  const groups = DOMAIN_ORDER.map((domain) => ({
    domain,
    label: DOMAIN_LABELS[domain] ?? domain,
    tools: cards.filter((card) => card.categoryId === domain),
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

      {/* Customer Zero Email P0 — the Correo capability, provider-first.
          The CEO sees ONE capability with providers, never "Sincronizar
          Gmail" as the product itself. */}
      <EmailConnectionSection
        org={organizationId}
        gmailCard={cards.find((c) => c.id === "gmail") ?? null}
        onConnectGoogle={() => {
          const gmail = cards.find((c) => c.id === "gmail");
          if (gmail) void runAction(gmail);
        }}
      />

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
        {card.description && (
          <p className="dfy-muted dfy-muted--small">{card.description}</p>
        )}

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
  other: "Otras herramientas",
};

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

/* ----------------------------------------------------------------------------
 * Customer Zero Email P0 — the Correo capability section.
 *
 * The CEO sees ONE capability ("Correo") with three provider options:
 * Google, Microsoft (honestly unavailable), and "Otro correo de empresa"
 * (IMAP + SMTP). Providers are infrastructure, never the product label.
 * --------------------------------------------------------------------------*/

interface EmailConnectionSectionProps {
  org: string | null;
  gmailCard: ConnectionCardView | null;
  onConnectGoogle: () => void;
}

function EmailConnectionSection(props: EmailConnectionSectionProps) {
  const [corporateOpen, setCorporateOpen] = useState(false);
  const [corporateBusy, setCorporateBusy] = useState(false);
  const [corporateStatus, setCorporateStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const gmailConnected = props.gmailCard?.state === "connected";

  async function configureCorporate(form: HTMLFormElement) {
    if (!props.org) return;
    setCorporateBusy(true);
    setCorporateStatus(null);
    const data = new FormData(form);
    const displayName = String(data.get("displayName") ?? "").trim();
    const payload: {
      email: string;
      username: string;
      password: string;
      imapHost: string;
      imapPort: number;
      imapSecure: boolean;
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      displayName?: string;
    } = {
      email: String(data.get("email") ?? "").trim(),
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
      imapHost: String(data.get("imapHost") ?? "").trim(),
      imapPort: Number(data.get("imapPort") ?? 993),
      imapSecure: true,
      smtpHost: String(data.get("smtpHost") ?? "").trim(),
      smtpPort: Number(data.get("smtpPort") ?? 587),
      smtpSecure: true,
    };
    if (displayName) payload.displayName = displayName;
    try {
      const out = await api.configureCorporateEmail(props.org, payload);
      if (!out) {
        setCorporateStatus({
          ok: false,
          message:
            "No hemos podido contactar con Departify. Vuelve a intentarlo en unos minutos.",
        });
        return;
      }
      if (out.operational) {
        setCorporateStatus({
          ok: true,
          message: `Correo conectado (${out.email}). Departify ya puede leer tu bandeja y enviar correos.`,
        });
      } else {
        const detail = out.probe.error
          ? ` (${out.probe.error.slice(0, 160)})`
          : "";
        setCorporateStatus({
          ok: false,
          message: `No se ha podido verificar la cuenta:${detail} Revisa servidor, puerto y contraseña de aplicación.`,
        });
      }
    } finally {
      setCorporateBusy(false);
    }
  }

  return (
    <section className="dfy-catalog-group" data-testid="email-capability-section">
      <h2 className="dfy-catalog-group__title">Correo</h2>
      <p className="dfy-muted dfy-muted--small">
        Conecta el correo que utiliza tu empresa para que Departify pueda leer,
        buscar, preparar y enviar emails cuando lo necesites.
      </p>
      <div className="dfy-grid">
        <Card>
          <div className="dfy-email-option">
            <div>
              <strong>Google / Gmail</strong>
              <p className="dfy-muted dfy-muted--small">
                {gmailConnected
                  ? "Conectado y operativo."
                  : "Conecta la cuenta de Gmail de tu empresa."}
              </p>
            </div>
            {gmailConnected ? (
              <Badge tone="success">Conectado</Badge>
            ) : (
              <button
                type="button"
                className="dfy-button dfy-button--small"
                onClick={props.onConnectGoogle}
              >
                Conectar
              </button>
            )}
          </div>
        </Card>

        <Card>
          <div className="dfy-email-option">
            <div>
              <strong>Microsoft 365 / Outlook</strong>
              <p className="dfy-muted dfy-muted--small">
                Próximamente.
              </p>
            </div>
            <Badge tone="neutral">Próximamente</Badge>
          </div>
        </Card>

        <Card>
          <div className="dfy-email-option">
            <div>
              <strong>Otro correo de empresa</strong>
              <p className="dfy-muted dfy-muted--small">
                {corporateOpen
                  ? "Configura tu cuenta IMAP + SMTP."
                  : "Correo corporativo con tu propio servidor (IMAP para leer, SMTP para enviar)."}
              </p>
            </div>
            <button
              type="button"
              className="dfy-button dfy-button--ghost dfy-button--small"
              onClick={() => setCorporateOpen((v) => !v)}
            >
              {corporateOpen ? "Cerrar" : "Configurar"}
            </button>
          </div>
          {corporateOpen && (
            <form
              className="dfy-email-form"
              onSubmit={(event) => {
                event.preventDefault();
                void configureCorporate(event.currentTarget);
              }}
            >
              <label>
                Correo
                <input name="email" type="email" required placeholder="ceo@tuempresa.com" />
              </label>
              <label>
                Usuario
                <input name="username" required placeholder="ceo@tuempresa.com" />
              </label>
              <label>
                Contraseña de aplicación
                <input name="password" type="password" required autoComplete="new-password" />
              </label>
              <label>
                Servidor IMAP
                <input name="imapHost" required placeholder="imap.tuempresa.com" />
              </label>
              <label>
                Puerto IMAP
                <input name="imapPort" type="number" defaultValue={993} />
              </label>
              <label>
                Servidor SMTP
                <input name="smtpHost" required placeholder="smtp.tuempresa.com" />
              </label>
              <label>
                Puerto SMTP
                <input name="smtpPort" type="number" defaultValue={587} />
              </label>
              <label>
                Nombre visible (opcional)
                <input name="displayName" placeholder="CEO" />
              </label>
              <button
                type="submit"
                className="dfy-button dfy-button--small"
                disabled={corporateBusy}
              >
                {corporateBusy ? "Comprobando…" : "Conectar y verificar"}
              </button>
              {corporateStatus && (
                <p
                  className={
                    corporateStatus.ok
                      ? "dfy-muted dfy-email-status--ok"
                      : "dfy-alert"
                  }
                  role={corporateStatus.ok ? "status" : "alert"}
                >
                  {corporateStatus.message}
                </p>
              )}
            </form>
          )}
        </Card>
      </div>
    </section>
  );
}
