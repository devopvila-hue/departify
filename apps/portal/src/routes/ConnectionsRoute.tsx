import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";

import {
  api,
  rememberGoogleOAuthReturnPath,
  type ToolConnectionView,
} from "@/app/api";
import { useOrg } from "@/app/org-context";

type SurfaceState = ToolConnectionView["state"] | "available";
type Surface = ToolConnectionView & {
  surfaceId: string;
  connectToolId: string | undefined;
  capabilityNames: string[];
  unavailableReason: string | undefined;
};

const CATEGORY_ORDER = ["email", "calendar", "documents", "crm", "marketing", "team", "other"] as const;
const SURFACE_CATALOG_IDS = new Set([
  "hostinger_email",
  "mautic",
  "gmail",
  "google_calendar",
  "google_drive",
  "google_analytics",
  "google_ads",
  "meta_ads",
  "tiktok_ads",
  "youtube",
  "ticktick",
]);
export function ConnectionsRoute() {
  const { organizationId } = useOrg();
  const location = useLocation();
  const [catalog, setCatalog] = useState<ToolConnectionView[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Surface | null>(null);
  const [confirming, setConfirming] = useState<Surface | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.connections(organizationId);
    if (data) setCatalog(data.connections ?? []);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  const surfaces = buildSurfaces(catalog);
  const connected = surfaces.filter((surface) => surface.state === "connected");
  const filtered = surfaces.filter((surface) => {
    const text = `${surface.name} ${surface.category} ${surface.description ?? ""}`.toLocaleLowerCase("es");
    return text.includes(query.trim().toLocaleLowerCase("es"));
  });
  const available = filtered.filter((surface) => surface.state !== "connected");
  const returnPath = new URLSearchParams(location.search).get("return") === "chat"
    ? "/chat"
    : "/conexiones";

  async function startConnect(surface: Surface, reconnect = false) {
    if (!organizationId || !surface.connectToolId || surface.unavailableReason) return;
    setBusy(surface.surfaceId);
    setNotice(null);
    try {
      const response = await api.connect(organizationId, surface.connectToolId, returnPath, reconnect);
      const authorizationUrl = response?.connection?.authorizationUrl;
      if (authorizationUrl) {
        rememberGoogleOAuthReturnPath(returnPath);
        window.location.href = authorizationUrl;
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(surface: Surface) {
    if (!organizationId || !surface.connectToolId) return;
    setBusy(surface.surfaceId);
    setNotice(null);
    try {
      const response = await api.disconnect(organizationId, surface.connectToolId);
      if (response?.state === "needs_connection") {
        setNotice(`${surface.name} se ha desconectado.`);
        setSelected(null);
        await load();
      } else {
        setNotice("No hemos podido desconectar esta cuenta. Vuelve a intentarlo.");
      }
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="dfy-page dfy-connections-page">
      <header className="dfy-connections-header">
        <div>
          <h1>CONEXIONES</h1>
          <p>Conecta las herramientas que ya utiliza tu empresa.</p>
        </div>
        <div className="dfy-connections-header__actions">
          <span className="dfy-connections-count" aria-label={`${connected.length} conexiones conectadas`}>
            {connected.length} conectadas
          </span>
          <button type="button" className="dfy-button" onClick={() => { setSearchOpen(true); setQuery(""); }}>
            + Añadir
          </button>
        </div>
      </header>

      {notice && <p className="dfy-connections-notice" role="status">{notice}</p>}

      <section aria-labelledby="connected-heading" className="dfy-connections-section">
        <div className="dfy-connections-section__heading">
          <h2 id="connected-heading">Conectadas</h2>
          <span>{connected.length}</span>
        </div>
        {connected.length === 0 ? (
          <div className="dfy-connections-empty">
            <p>Aún no hay herramientas conectadas.</p>
            <button type="button" className="dfy-button dfy-button--small" onClick={() => setSearchOpen(true)}>
              Añadir una conexión
            </button>
          </div>
        ) : (
          <div className="dfy-connections-grid">
            {connected.map((surface) => (
              <ConnectionTile key={surface.surfaceId} surface={surface} onOpen={() => setSelected(surface)} />
            ))}
          </div>
        )}
      </section>

      {searchOpen && (
        <div className="dfy-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSearchOpen(false);
        }}>
          <section className="dfy-dialog dfy-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-title">
            <div className="dfy-dialog__header">
              <div>
                <h2 id="catalog-title">Añadir una conexión</h2>
                <p>Elige una herramienta que Departify puede conectar o preparar.</p>
              </div>
              <button type="button" className="dfy-icon-button" aria-label="Cerrar catálogo" onClick={() => setSearchOpen(false)}>×</button>
            </div>
            <label className="dfy-search-field">
              <span>Buscar herramienta</span>
              <input
                type="search"
                role="searchbox"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Busca por nombre"
                autoFocus
              />
            </label>
            <div className="dfy-catalog-list">
              {available.length === 0 ? (
                <p className="dfy-muted">No encontramos una herramienta con ese nombre.</p>
              ) : available.map((surface) => (
                <button key={surface.surfaceId} type="button" className="dfy-catalog-row" onClick={() => { setSearchOpen(false); setSelected(surface); }}>
                  <ConnectionLogo surface={surface} />
                  <span className="dfy-catalog-row__copy">
                    <strong>{surface.name}</strong>
                    <small>{surface.category}</small>
                  </span>
                  <span className="dfy-catalog-row__state">{surface.state === "available" ? "Disponible" : stateLabel(surface.state)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {selected && (
        <ManageDialog
          surface={selected}
          busy={busy === selected.surfaceId}
          onClose={() => setSelected(null)}
          onRefresh={() => void load()}
          onConnect={(reconnect) => void startConnect(selected, reconnect)}
          onDisconnect={() => setConfirming(selected)}
        />
      )}

      {confirming && (
        <div className="dfy-overlay dfy-overlay--front" role="presentation">
          <section className="dfy-dialog dfy-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="disconnect-title">
            <h2 id="disconnect-title">¿Desconectar {confirming.name}?</h2>
            <p>Departify dejará de usar esta cuenta y eliminará su autorización guardada. Tendrás que volver a autorizarla para conectarla otra vez.</p>
            <div className="dfy-dialog__actions">
              <button ref={confirmRef} type="button" className="dfy-button dfy-button--ghost" onClick={() => setConfirming(null)}>Cancelar</button>
              <button type="button" className="dfy-button dfy-button--danger" disabled={busy === confirming.surfaceId} onClick={() => void disconnect(confirming)}>
                {busy === confirming.surfaceId ? "Desconectando…" : "Desconectar"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ConnectionTile(props: { surface: Surface; onOpen: () => void }) {
  const { surface } = props;
  return (
    <button type="button" className="dfy-connection-tile" onClick={props.onOpen} aria-label={`${surface.name}, ${stateLabel(surface.state)}`}>
      <ConnectionLogo surface={surface} />
      <span className="dfy-connection-tile__body">
        <strong>{surface.name}</strong>
        <span className="dfy-connection-tile__status"><i aria-hidden="true" />{stateLabel(surface.state)}</span>
        {surface.accountLabel && <small>{surface.accountLabel}</small>}
      </span>
      <span className="dfy-connection-tile__chevron" aria-hidden="true">›</span>
    </button>
  );
}

function ManageDialog(props: {
  surface: Surface;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onConnect: (reconnect: boolean) => void;
  onDisconnect: () => void;
}) {
  const { surface } = props;
  const connected = surface.state === "connected";
  const canDisconnect = connected && Boolean(surface.connectToolId) && !surface.configSource?.startsWith("env:");
  return (
    <div className="dfy-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section className="dfy-dialog dfy-manage-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-title">
        <div className="dfy-dialog__header">
          <div className="dfy-dialog__identity">
            <ConnectionLogo surface={surface} />
            <div>
              <h2 id="manage-title">{surface.name}</h2>
              <span className="dfy-dialog__state"><i aria-hidden="true" />{stateLabel(surface.state)}</span>
            </div>
          </div>
          <button type="button" className="dfy-icon-button" aria-label="Cerrar gestión" onClick={props.onClose}>×</button>
        </div>
        {surface.accountLabel && <p className="dfy-account-label">Cuenta: <strong>{surface.accountLabel}</strong></p>}
        <div className="dfy-manage-block">
          <h3>Lo que puede hacer Elvira</h3>
          {surface.capabilityNames.length > 0 ? (
            <ul>{surface.capabilityNames.slice(0, 8).map((capability) => <li key={capability}>{capability}</li>)}</ul>
          ) : <p className="dfy-muted">Las capacidades se mostrarán cuando la cuenta esté verificada.</p>}
        </div>
        {surface.verifiedAt && <p className="dfy-last-check">Última comprobación: {formatDate(surface.verifiedAt)}</p>}
        {surface.unavailableReason && <p className="dfy-dialog__hint">{surface.unavailableReason}</p>}
        <div className="dfy-dialog__actions dfy-dialog__actions--stack">
          {connected ? (
            <>
              <button type="button" className="dfy-button dfy-button--ghost" disabled={props.busy} onClick={props.onRefresh}>Actualizar estado</button>
              {surface.connectToolId && !surface.configSource?.startsWith("env:") && <button type="button" className="dfy-button dfy-button--ghost" disabled={props.busy} onClick={() => props.onConnect(true)}>Conectar otra cuenta</button>}
              {canDisconnect ? (
                <button type="button" className="dfy-button dfy-button--danger-ghost" disabled={props.busy} onClick={props.onDisconnect}>Desconectar</button>
              ) : <small className="dfy-dialog__hint">Esta conexión está gestionada por la empresa.</small>}
            </>
          ) : (
            <button type="button" className="dfy-button" disabled={props.busy || Boolean(surface.unavailableReason)} onClick={() => props.onConnect(false)}>
              {props.busy ? "Conectando…" : surface.unavailableReason ? "No disponible todavía" : "Conectar"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function buildSurfaces(catalog: readonly ToolConnectionView[]): Surface[] {
  const normalizedCatalog = catalog
    .map((entry) => normalizeConnectionView(entry))
    .filter((entry): entry is ToolConnectionView => entry !== null);
  const direct = normalizedCatalog
    .filter((entry) => entry.userVisible !== false && entry.toolId !== "meta_business" && SURFACE_CATALOG_IDS.has(entry.toolId))
    .map((entry) => surfaceFrom(entry));
  const meta = normalizedCatalog.find((entry) => entry.toolId === "meta_business");
  if (meta) {
    direct.push(metaSurface(meta, "facebook", "Facebook", "Consulta y prepara publicaciones de tus páginas de Facebook.", ["marketing.social.read", "marketing.social.publish"]));
    direct.push(metaSurface(meta, "instagram", "Instagram", "Conecta Instagram cuando la cuenta conceda permisos específicos para ese canal.", ["marketing.instagram.read", "marketing.social.instagram.read"]));
  } else {
    direct.push(metaSurface(null, "facebook", "Facebook", "Conecta tus páginas de Facebook.", ["marketing.social.read"]));
    direct.push(metaSurface(null, "instagram", "Instagram", "Conecta tu cuenta de Instagram.", ["marketing.instagram.read"]));
  }
  return direct.sort(compareSurfaces);
}

const CONNECTION_STATES = new Set<SurfaceState>([
  "available",
  "selected",
  "needs_connection",
  "configured",
  "connected",
  "degraded",
  "unavailable",
]);

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The API is a runtime boundary, not a TypeScript guarantee. Older or
 * partially populated catalog projections may omit optional identity fields.
 * Prefer canonical name/label metadata and use the stable tool id only as a
 * last-resort technical identity; never let malformed metadata reach sorting.
 */
function normalizeConnectionView(entry: unknown): ToolConnectionView | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const toolId = textValue(raw.toolId);
  if (!toolId) return null;

  const label = textValue(raw.label) ?? textValue(raw.name) ?? toolId;
  const name = textValue(raw.name) ?? label;
  const categoryId = CATEGORY_ORDER.includes(raw.categoryId as typeof CATEGORY_ORDER[number])
    ? raw.categoryId as ToolConnectionView["categoryId"]
    : "other";
  const state = CONNECTION_STATES.has(raw.state as SurfaceState)
    ? raw.state as ToolConnectionView["state"]
    : "available";
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((value): value is string => typeof value === "string")
    : [];
  const validDomains = new Set<ToolConnectionView["domains"][number]>([
    "crm",
    "email",
    "calendar",
    "documents",
    "marketing",
    "team",
  ]);
  const domains = Array.isArray(raw.domains)
    ? raw.domains.filter((value): value is ToolConnectionView["domains"][number] => typeof value === "string" && validDomains.has(value as ToolConnectionView["domains"][number]))
    : [];
  const description = textValue(raw.description);
  const accountLabel = textValue(raw.accountLabel);
  const configSource = textValue(raw.configSource);
  const verifiedAt = textValue(raw.verifiedAt);
  const blockedReason = textValue(raw.blockedReason);

  return {
    toolId,
    label,
    name,
    capability: textValue(raw.capability) ?? "unknown",
    capabilities,
    category: textValue(raw.category) ?? "Otros",
    categoryId,
    logoMark: textValue(raw.logoMark) ?? label.slice(0, 1),
    brandColor: textValue(raw.brandColor) ?? "#6b7280",
    ...(description ? { description } : {}),
    ...(accountLabel ? { accountLabel } : {}),
    ...(configSource ? { configSource } : {}),
    ...(raw.userVisible === false ? { userVisible: false } : {}),
    domains,
    state,
    hasState: raw.hasState === true,
    humanLabel: textValue(raw.humanLabel) ?? "Disponible",
    action: raw.action === "prepare" || raw.action === "connect" || raw.action === "verify" || raw.action === "retry"
      ? raw.action
      : null,
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(blockedReason ? { blockedReason } : {}),
  };
}

function compareSurfaces(a: Surface, b: Surface): number {
  const categoryA = CATEGORY_ORDER.indexOf(a.categoryId);
  const categoryB = CATEGORY_ORDER.indexOf(b.categoryId);
  const categoryOrderA = categoryA < 0 ? CATEGORY_ORDER.length : categoryA;
  const categoryOrderB = categoryB < 0 ? CATEGORY_ORDER.length : categoryB;
  return categoryOrderA - categoryOrderB
    || a.name.localeCompare(b.name, "es")
    || a.surfaceId.localeCompare(b.surfaceId, "en");
}

function surfaceFrom(entry: ToolConnectionView): Surface {
  const connectable = entry.toolId === "gmail" || entry.toolId === "google_calendar" || entry.toolId === "google_drive" || entry.toolId === "mautic" || entry.toolId === "ticktick";
  return {
    ...entry,
    surfaceId: entry.toolId,
    capabilityNames: capabilityNames(entry),
    connectToolId: connectable ? entry.toolId : undefined,
    unavailableReason: entry.state === "available" && !connectable
      ? "Esta conexión aún no está disponible para configurarse desde el portal."
      : undefined,
  };
}

function metaSurface(source: ToolConnectionView | null, surfaceId: "facebook" | "instagram", name: string, description: string, grants: string[]): Surface {
  const capabilities = source?.capabilities ?? [];
  const hasGrant = grants.some((grant) => capabilities.includes(grant));
  const connected = source?.state === "connected" && hasGrant;
  return {
    toolId: surfaceId,
    surfaceId,
    name,
    label: name,
    capability: grants[0] ?? "marketing.social.read",
    capabilities: connected ? capabilities : [],
    category: "Marketing",
    categoryId: "marketing",
    logoMark: surfaceId === "facebook" ? "f" : "◎",
    brandColor: surfaceId === "facebook" ? "#1877f2" : "#d62976",
    description,
    domains: ["marketing"],
    state: connected ? "connected" : "available",
    hasState: Boolean(source?.hasState),
    humanLabel: connected ? "Conectado" : "Disponible",
    action: connected ? null : "connect",
    capabilityNames: connected ? grants.map(humanCapability) : [],
    connectToolId: "meta_business",
    unavailableReason: undefined,
  };
}

function ConnectionLogo({ surface }: { surface: Surface }) {
  const color = surface.brandColor;
  return (
    <span className={`dfy-connection-logo dfy-connection-logo--${surface.surfaceId}`} style={{ "--logo-color": color } as CSSProperties} aria-hidden="true">
      {surface.surfaceId === "gmail" ? <svg viewBox="0 0 24 24"><path fill="#ea4335" d="M2 5.5 12 13 22 5.5V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" /><path fill="#fff" d="M2 5.5 12 13l10-7.5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path fill="#c5221f" d="m2 5.5 4 3V21H4a2 2 0 0 1-2-2Z" /><path fill="#a50e0e" d="m22 5.5-4 3V21h2a2 2 0 0 0 2-2Z" /></svg>
        : surface.surfaceId === "google_calendar" ? <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" fill="#4285f4" /><path fill="#fff" d="M7 2h2v4H7zm8 0h2v4h-2zM6 9h12v2H6zm0 4h4v4H6z" /></svg>
        : surface.surfaceId === "google_drive" ? <svg viewBox="0 0 24 24"><path fill="#0f9d58" d="m8 3 4 7H4Z" /><path fill="#fbbc04" d="m12 10 4-7 4 7-4 7Z" /><path fill="#4285f4" d="M4 10h8l4 7H8Z" /><path fill="#34a853" d="m8 17-3 4h8l3-4Z" /></svg>
        : surface.surfaceId === "google_analytics" ? <svg viewBox="0 0 24 24"><path fill="#f9ab00" d="M4 19V9a2 2 0 1 1 4 0v10a2 2 0 1 1-4 0Zm6 0V5a2 2 0 1 1 4 0v14a2 2 0 1 1-4 0Zm6 0v-5a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0Z" /></svg>
        : surface.surfaceId === "google_ads" ? <svg viewBox="0 0 24 24"><path fill="#4285f4" d="m5 18 7-12 2.5 4.3-4.5 7.7Z" /><path fill="#34a853" d="m12 6 2.5-4 6 10.5-4.5 7.7Z" /><path fill="#fbbc04" d="M5 18h8l2.5 4H7.5Z" /></svg>
        : surface.surfaceId === "meta_ads" ? <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877f2" /><path fill="#fff" d="M13.3 19v-6h2l.3-2.2h-2.3V9.4c0-.7.2-1.2 1.2-1.2h1.2V6.2c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.6H9v2.2h1.9v6Z" /></svg>
        : surface.surfaceId === "tiktok_ads" ? <svg viewBox="0 0 24 24"><path fill="#25f4ee" d="M15 4c.4 2.1 1.5 3.3 3.7 3.5v2.7a7.6 7.6 0 0 1-3.7-1.1v5.6a5.3 5.3 0 1 1-4.5-5.2v2.8a2.6 2.6 0 1 0 1.8 2.4V4Z" /><path fill="#fe2c55" d="M13.7 3c.4 2.1 1.5 3.3 3.7 3.5v2.7a7.6 7.6 0 0 1-3.7-1.1v5.6a5.3 5.3 0 1 1-4.5-5.2v2.8a2.6 2.6 0 1 0 1.8 2.4V3Z" /></svg>
        : surface.surfaceId === "facebook" ? <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877f2" /><path fill="#fff" d="M13.3 19v-6h2l.3-2.2h-2.3V9.4c0-.7.2-1.2 1.2-1.2h1.2V6.2c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.6H9v2.2h1.9v6Z" /></svg>
        : surface.surfaceId === "instagram" ? <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="#d62976" strokeWidth="2.5" /><circle cx="12" cy="12" r="4" fill="none" stroke="#d62976" strokeWidth="2.2" /><circle cx="17.5" cy="6.7" r="1.2" fill="#d62976" /></svg>
        : <strong>{surface.logoMark}</strong>}
    </span>
  );
}

function capabilityNames(surface: ToolConnectionView): string[] {
  return (surface.capabilities ?? []).map(humanCapability);
}

function humanCapability(capability: string): string {
  const labels: Record<string, string> = {
    "email.read": "Leer correos",
    "email.search": "Buscar correos",
    "email.thread.read": "Leer hilos de correo",
    "email.send.personal": "Enviar correos",
    "calendar.read": "Consultar calendario",
    "calendar.create": "Crear eventos",
    "drive.read": "Leer documentos",
    "drive.search": "Buscar documentos",
    "marketing.social.read": "Consultar canales sociales",
    "marketing.social.publish": "Preparar publicaciones",
  };
  return labels[capability] ?? capability.replace(/^[^.]+./, "").replace(/[._]/g, " ");
}

function stateLabel(state: SurfaceState): string {
  if (state === "connected") return "Conectado";
  if (state === "needs_connection" || state === "degraded" || state === "unavailable") return "Necesita atención";
  if (state === "selected") return "Disponible";
  return "Disponible";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(value));
}
