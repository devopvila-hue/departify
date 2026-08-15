import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  api,
  rememberGoogleOAuthReturnPath,
  type ToolConnectionView,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { EmptyState } from "@/components/primitives";

type SurfaceState = "connected" | "available" | "attention";

interface SurfaceConnection {
  id: string;
  sourceToolId: string;
  name: string;
  categoryId: ToolConnectionView["categoryId"];
  description: string;
  state: SurfaceState;
  action: ToolConnectionView["action"];
  capabilities: string[];
  accountLabel?: string | undefined;
  verifiedAt?: string | undefined;
  blockedReason?: string | undefined;
  brandColor: string;
}

const SURFACE_IDS = [
  "mautic",
  "hostinger_email",
  "gmail",
  "google_calendar",
  "google_drive",
  "google_analytics",
  "google_ads",
  "facebook",
  "instagram",
  "meta_ads",
  "tiktok_ads",
] as const;

const CONNECTABLE_IDS = new Set([
  "mautic",
  "gmail",
  "google_calendar",
  "google_drive",
  "meta_ads",
  "facebook",
  "instagram",
]);

const CATEGORY_LABELS: Record<string, string> = {
  crm: "CRM",
  email: "Correo",
  calendar: "Calendario",
  documents: "Documentos",
  marketing: "Marketing",
  team: "Equipo",
  other: "Otros",
};

const CAPABILITY_LABELS: Record<string, string> = {
  "email.read": "Leer correos",
  "email.search": "Buscar en el correo",
  "email.send": "Preparar y enviar correos",
  "email.send.personal": "Enviar correos autorizados",
  "calendar.read": "Consultar el calendario",
  "calendar.create": "Crear eventos",
  "drive.read": "Leer documentos",
  "drive.search": "Buscar documentos",
  "crm.contacts.read": "Consultar contactos",
  "marketing.social.read": "Consultar publicaciones y páginas",
  "marketing.social.publish": "Publicar contenido aprobado",
  "marketing.ads.read": "Consultar campañas publicitarias",
  "marketing.ads.analyze": "Analizar campañas publicitarias",
};

export function ConnectionsRoute() {
  const { organizationId } = useOrg();
  const location = useLocation();
  const [connections, setConnections] = useState<ToolConnectionView[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.connections(organizationId);
    if (!data) {
      setError("No hemos podido cargar tus conexiones. Vuelve a intentarlo.");
      return;
    }
    setConnections(data.connections ?? []);
    setUnmapped(data.unmappedTools ?? []);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const surfaces = useMemo(
    () => buildSurfaceConnections(connections),
    [connections],
  );
  const connected = surfaces.filter((item) => item.state === "connected");
  const selected = selectedId ? surfaces.find((item) => item.id === selectedId) ?? null : null;
  const catalog = surfaces.filter((item) => item.state !== "connected");
  const filteredCatalog = catalog.filter((item) => {
    const haystack = `${item.name} ${item.description} ${CATEGORY_LABELS[item.categoryId]}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  function openManage(item: SurfaceConnection) {
    setCatalogOpen(false);
    setSearch("");
    setError(null);
    setNotice(null);
    setSelectedId(item.id);
  }

  async function startConnect(item: SurfaceConnection, reconnect = false) {
    if (!organizationId || busy) return;
    if (!CONNECTABLE_IDS.has(item.id) && item.sourceToolId === item.id) {
      setError("Esta conexión todavía no está disponible para tu empresa.");
      return;
    }
    setBusy(item.id);
    setError(null);
    setNotice(null);
    const returnPath = new URLSearchParams(location.search).get("return") === "chat"
      ? "/chat"
      : "/conexiones";
    try {
      const out = await api.connect(organizationId, item.sourceToolId, returnPath, reconnect);
      const connection = out?.connection as (ToolConnectionView & {
        authorizationUrl?: string;
        blockedReason?: string;
        status?: string;
      }) | undefined;
      if (connection?.authorizationUrl) {
        rememberGoogleOAuthReturnPath(returnPath);
        window.location.href = connection.authorizationUrl;
        return;
      }
      if (connection?.status === "blocked" || connection?.blockedReason) {
        setError("No se ha podido iniciar esta conexión. Estamos revisando su configuración.");
      } else {
        setNotice("Hemos actualizado el estado de la conexión.");
        await load();
      }
    } catch {
      setError("No se ha podido iniciar esta conexión. Vuelve a intentarlo.");
    } finally {
      setBusy(null);
    }
  }

  async function checkConnection(item: SurfaceConnection) {
    if (!organizationId || busy) return;
    setBusy(item.id);
    setError(null);
    try {
      const result = await api.testConnection(organizationId, item.sourceToolId);
      if (!result || result.state !== "connected") {
        setError("La conexión necesita atención. Puedes volver a comprobarla más tarde.");
      } else {
        setNotice("Conexión comprobada correctamente.");
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(item: SurfaceConnection) {
    if (!organizationId || busy) return;
    if (!window.confirm(`¿Desconectar ${item.name}? Elvira dejará de usar esta cuenta.`)) return;
    setBusy(item.id);
    setError(null);
    try {
      const result = await api.disconnect(organizationId, item.sourceToolId);
      if (!result || result.state !== "needs_connection") {
        setError("No hemos podido desconectar esta cuenta. Vuelve a intentarlo.");
        return;
      }
      setSelectedId(null);
      setNotice("Cuenta desconectada. Elvira ya no puede usarla.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dfy-page dfy-connections-page">
      <header className="dfy-connections-heading">
        <div>
          <h1>Conexiones</h1>
          <p>Conecta las herramientas que ya utiliza tu empresa.</p>
        </div>
        <div className="dfy-connections-heading__actions">
          <span className="dfy-connections-count"><strong>{connected.length}</strong> conectadas</span>
          <button type="button" className="dfy-button" onClick={() => setCatalogOpen(true)}>
            + Añadir
          </button>
        </div>
      </header>

      {error && <p className="dfy-alert" role="alert">{error}</p>}
      {notice && <p className="dfy-connections-notice" role="status">{notice}</p>}

      {connected.length === 0 ? (
        <EmptyState title="No hay conexiones disponibles" description="Vuelve a intentarlo en unos minutos." />
      ) : (
        <div className="dfy-connections-grid" aria-label="Herramientas conectadas">
          {connected.map((item) => (
            <ConnectionTile key={item.id} item={item} onClick={() => openManage(item)} />
          ))}
        </div>
      )}

      {unmapped.length > 0 && (
        <p className="dfy-muted dfy-muted--small">Otras herramientas detectadas: {unmapped.join(", ")}</p>
      )}

      {catalogOpen && (
        <CatalogDialog
          items={filteredCatalog}
          search={search}
          onSearch={setSearch}
          onClose={() => { setCatalogOpen(false); setSearch(""); }}
          onSelect={openManage}
        />
      )}

      {selected && (
        <ManageDialog
          item={selected}
          busy={busy === selected.id}
          onClose={() => setSelectedId(null)}
          onConnect={(reconnect) => void startConnect(selected, reconnect)}
          onCheck={() => void checkConnection(selected)}
          onDisconnect={() => void disconnect(selected)}
        />
      )}
    </div>
  );
}

function buildSurfaceConnections(canonical: ToolConnectionView[]): SurfaceConnection[] {
  const byId = new Map(canonical.map((item) => [item.toolId, item]));
  return SURFACE_IDS.map((id) => {
    const source = id === "facebook" || id === "instagram" ? byId.get("meta_business") : byId.get(id);
    if (id === "facebook" || id === "instagram") {
      const socialCapabilities = source?.capabilities ?? [];
      const socialConnected = source?.state === "connected" && (
        id === "facebook"
          ? socialCapabilities.includes("marketing.social.read")
          : socialCapabilities.some((capability) => capability.includes("instagram"))
      );
      return {
        id,
        sourceToolId: "meta_business",
        name: id === "facebook" ? "Facebook" : "Instagram",
        categoryId: "marketing",
        description: id === "facebook" ? "Páginas y publicaciones de tu empresa." : "Contenido de la cuenta de Instagram.",
        state: socialConnected ? "connected" : source?.blockedReason ? "attention" : "available",
        action: source?.action ?? null,
        capabilities: socialConnected ? socialCapabilities : [],
        accountLabel: source?.accountLabel,
        verifiedAt: source?.verifiedAt,
        blockedReason: source?.blockedReason,
        brandColor: id === "facebook" ? "#1877f2" : "#d62976",
      };
    }
    if (!source) return fallbackSurface(id);
    return {
      id,
      sourceToolId: id,
      name: source.name,
      categoryId: source.categoryId,
      description: source.description ?? "Conecta esta herramienta para trabajar con datos reales.",
      state: businessState(source),
      action: source.action,
      capabilities: source.capabilities ? [...source.capabilities] : [],
      accountLabel: source.accountLabel,
      verifiedAt: source.verifiedAt,
      blockedReason: source.blockedReason,
      brandColor: source.brandColor,
    };
  });
}

function fallbackSurface(id: string): SurfaceConnection {
  const names: Record<string, string> = {
    google_analytics: "Google Analytics",
    google_ads: "Google Ads",
    meta_ads: "Meta Ads",
    tiktok_ads: "TikTok Ads",
  };
  return {
    id,
    sourceToolId: id,
    name: names[id] ?? id,
    categoryId: "marketing",
    description: "Disponible cuando la conexión esté habilitada.",
    state: "available",
    action: null,
    capabilities: [],
    brandColor: "#5b6b7f",
  };
}

function businessState(source: ToolConnectionView): SurfaceState {
  if (source.state === "connected") return "connected";
  if (source.state === "degraded" || source.state === "unavailable" || source.blockedReason) return "attention";
  return "available";
}

function ConnectionTile(props: { item: SurfaceConnection; onClick: () => void }) {
  return (
    <button type="button" className="dfy-connection-tile" onClick={props.onClick}>
      <ConnectionLogo id={props.item.id} color={props.item.brandColor} />
      <span className="dfy-connection-tile__body">
        <strong>{props.item.name}</strong>
        <span className="dfy-connection-tile__status"><StatusDot state={props.item.state} />{statusLabel(props.item.state)}</span>
      </span>
      <span className="dfy-connection-tile__arrow" aria-hidden="true">›</span>
    </button>
  );
}

function CatalogDialog(props: {
  items: SurfaceConnection[];
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (item: SurfaceConnection) => void;
}) {
  return (
    <div className="dfy-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="dfy-modal" role="dialog" aria-modal="true" aria-labelledby="connection-catalog-title">
        <div className="dfy-modal__head">
          <div><h2 id="connection-catalog-title">Añadir una conexión</h2><p>Elige una herramienta compatible con tu empresa.</p></div>
          <button type="button" className="dfy-icon-button" aria-label="Cerrar catálogo" onClick={props.onClose}>×</button>
        </div>
        <input
          className="dfy-modal__search"
          type="search"
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder="Buscar herramienta"
          aria-label="Buscar herramienta"
          autoFocus
        />
        <div className="dfy-catalog-list">
          {props.items.length === 0 ? <p className="dfy-muted">No encontramos esa herramienta.</p> : props.items.map((item) => (
            <button type="button" className="dfy-catalog-option" key={item.id} onClick={() => props.onSelect(item)}>
              <ConnectionLogo id={item.id} color={item.brandColor} small />
              <span><strong>{item.name}</strong><small>{CATEGORY_LABELS[item.categoryId]} · {statusLabel(item.state)}</small></span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ManageDialog(props: {
  item: SurfaceConnection;
  busy: boolean;
  onClose: () => void;
  onConnect: (reconnect: boolean) => void;
  onCheck: () => void;
  onDisconnect: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const canConnect = CONNECTABLE_IDS.has(props.item.id) || props.item.sourceToolId !== props.item.id;
  const canCheck = props.item.id === "mautic" || props.item.id === "hostinger_email";
  const canDisconnect = props.item.state === "connected" && ["gmail", "google_calendar", "google_drive", "mautic", "hostinger_email", "facebook", "instagram", "meta_ads"].includes(props.item.id);
  const capabilities = props.item.capabilities
    .map((capability) => CAPABILITY_LABELS[capability] ?? null)
    .filter((label): label is string => Boolean(label));

  return (
    <div className="dfy-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="dfy-drawer" role="dialog" aria-modal="true" aria-labelledby="connection-manage-title">
        <div className="dfy-modal__head">
          <div className="dfy-drawer__identity"><ConnectionLogo id={props.item.id} color={props.item.brandColor} /><div><h2 id="connection-manage-title">{props.item.name}</h2><p><StatusDot state={props.item.state} /> {statusLabel(props.item.state)}</p></div></div>
          <button ref={closeRef} type="button" className="dfy-icon-button" aria-label="Cerrar gestión" onClick={props.onClose}>×</button>
        </div>
        {props.item.accountLabel && <p className="dfy-drawer__account">Cuenta: <strong>{props.item.accountLabel}</strong></p>}
        {props.item.description && <p className="dfy-muted">{props.item.description}</p>}
        {props.item.state === "connected" && capabilities.length > 0 && (
          <div className="dfy-drawer__section"><h3>Elvira puede</h3><ul>{capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul></div>
        )}
        {props.item.verifiedAt && <p className="dfy-muted dfy-muted--small">Última comprobación: {formatDate(props.item.verifiedAt)}</p>}
        {props.item.blockedReason && <p className="dfy-alert">{friendlyBlockReason(props.item.blockedReason)}</p>}
        {props.item.state !== "connected" && (
          <div className="dfy-drawer__section"><p className="dfy-muted">Esta herramienta aparecerá aquí cuando la conexión esté lista para usarse.</p></div>
        )}
        <div className="dfy-drawer__actions">
          {props.item.state === "connected" && ["gmail", "google_calendar", "google_drive"].includes(props.item.id) && (
            <button type="button" className="dfy-button" disabled={props.busy} onClick={() => props.onConnect(true)}>Conectar otra cuenta</button>
          )}
          {props.item.state !== "connected" && canConnect && (
            <button type="button" className="dfy-button" disabled={props.busy || Boolean(props.item.blockedReason)} onClick={() => props.onConnect(false)}>
              {props.busy ? "Conectando…" : "Conectar"}
            </button>
          )}
          {canCheck && props.item.state === "connected" && <button type="button" className="dfy-button dfy-button--ghost" disabled={props.busy} onClick={props.onCheck}>Comprobar conexión</button>}
          {canDisconnect && <button type="button" className="dfy-button dfy-button--danger" disabled={props.busy} onClick={props.onDisconnect}>Desconectar</button>}
          {!canConnect && props.item.state !== "connected" && <p className="dfy-muted dfy-muted--small">Esta conexión estará disponible próximamente.</p>}
        </div>
      </section>
    </div>
  );
}

function StatusDot(props: { state: SurfaceState }) {
  return <span className={`dfy-status-dot dfy-status-dot--${props.state}`} aria-hidden="true" />;
}

function statusLabel(state: SurfaceState): string {
  return state === "connected" ? "Conectado" : state === "attention" ? "Necesita atención" : "Disponible";
}

function friendlyBlockReason(reason: string): string {
  if (/credencial|credential|configur/i.test(reason)) return "Esta conexión necesita configuración de Departify antes de poder activarse.";
  return "Esta conexión necesita atención antes de poder usarse.";
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("es-ES"); } catch { return iso; }
}

function ConnectionLogo(props: { id: string; color: string; small?: boolean }) {
  const size = props.small ? 32 : 42;
  const common = { width: size, height: size, viewBox: "0 0 42 42", role: "img" as const, "aria-label": `${props.id} logo` };
  if (props.id === "gmail") return <svg {...common}><rect width="42" height="42" rx="11" fill="#fff" /><path d="M8 12v19h5V18l8 6 8-6v13h5V12l-5 4-8 6-8-6-5-4Z" fill="#ea4335" /><path d="M8 12l13 10 13-10" fill="none" stroke="#4285f4" strokeWidth="3" /></svg>;
  if (props.id === "google_calendar") return <svg {...common}><rect x="7" y="8" width="28" height="27" rx="5" fill="#4285f4" /><path d="M12 17h18v13H12z" fill="#fff" /><path d="M12 12h18v6H12z" fill="#34a853" /><text x="21" y="28" textAnchor="middle" fontSize="12" fontWeight="700" fill="#4285f4">31</text></svg>;
  if (props.id === "google_drive") return <svg {...common}><path d="M16 7h10l10 18H26L16 7Z" fill="#0f9d58" /><path d="M16 7 6 25h10l10-18H16Z" fill="#fbbc04" /><path d="M6 25h20l5 10H11L6 25Z" fill="#4285f4" /></svg>;
  if (props.id === "google_analytics") return <svg {...common}><path d="M12 33V20a3 3 0 1 1 6 0v13h-6Zm9 0V11a3 3 0 1 1 6 0v22h-6Zm9 0V7a3 3 0 1 1 6 0v26h-6Z" fill="#f9ab00" /></svg>;
  if (props.id === "google_ads") return <svg {...common}><path d="M15 8a6 6 0 0 1 8 2l10 17a5 5 0 1 1-9 5L14 15a5 5 0 0 1 1-7Z" fill="#34a853" /><circle cx="12" cy="30" r="6" fill="#fbbc04" /></svg>;
  if (props.id === "facebook") return <svg {...common}><circle cx="21" cy="21" r="16" fill="#1877f2" /><path d="M23 36V23h4l1-5h-5v-3c0-1.5 1-2.5 3-2.5h2V8c-1-.2-2-.3-3-.3-4 0-6.5 2.4-6.5 6.7V18h-4v5h4v13h4.5Z" fill="#fff" /></svg>;
  if (props.id === "instagram") return <svg {...common}><rect x="7" y="7" width="28" height="28" rx="8" fill="url(#ig)" /><defs><linearGradient id="ig" x1="8" y1="34" x2="34" y2="8"><stop stopColor="#feda75" /><stop offset=".45" stopColor="#d62976" /><stop offset="1" stopColor="#4f5bd5" /></linearGradient></defs><circle cx="21" cy="21" r="7" fill="none" stroke="#fff" strokeWidth="2.5" /><circle cx="29" cy="13" r="1.8" fill="#fff" /></svg>;
  if (props.id === "tiktok_ads") return <svg {...common}><rect x="8" y="6" width="26" height="30" rx="7" fill="#111" /><path d="M22 12v13a4 4 0 1 1-4-4" fill="none" stroke="#25f4ee" strokeWidth="3" /><path d="M24 11c1 3 3 4 6 4" fill="none" stroke="#fe2c55" strokeWidth="3" /></svg>;
  return <span className="dfy-connection-logo-fallback" style={{ background: props.color }}>{props.id === "hostinger_email" ? "@" : props.id === "mautic" ? "M" : "•"}</span>;
}
