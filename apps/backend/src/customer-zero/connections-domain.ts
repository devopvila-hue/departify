/**
 * Connections Domain — Customer Zero 01.
 *
 * Departify-owned connection model. Five business-language states,
 * capability-first discovery, official provider logos. No secrets in
 * this module — only safe metadata and configuration references.
 *
 * The legacy module `connections.ts` keeps the OAuth handshake + the
 * legacy status enum for backward compatibility; this new module
 * exposes the authoritative Customer Zero 01 connection surface that
 * the portal and the API render.
 */

import { t, type SupportedLocale } from "./locale.js";
import {
  type OrganizationToolState,
  type ToolLifecycleStatus,
} from "./tool-state.js";

/**
 * The five business-language states surfaced to the CEO.
 *
 *   not_connected     — nothing configured.
 *   connecting        — handshake in flight.
 *   connected         — verified; connector is operational.
 *   needs_attention   — credentials present but not valid; or degraded.
 *   error             — connector cannot be used right now.
 */
export type ConnectionState =
  | "not_connected"
  | "connecting"
  | "connected"
  | "needs_attention"
  | "error";

export interface CapabilityDefinition {
  /** Stable business capability id (e.g. "crm.contacts.read"). */
  readonly id: string;
  /** Human label (es + en). */
  readonly nameEs: string;
  readonly nameEn: string;
}

export type ConnectionCategory =
  | "crm"
  | "email"
  | "calendar"
  | "documents"
  | "marketing"
  | "team"
  | "other";

export interface ConnectionDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectionCategory;
  readonly categoryEs: string;
  readonly categoryEn: string;
  /** Inline mark used for the brand logo (initials or short token). */
  readonly logoMark: string;
  /** Optional brand color (hex) for accents on the card. */
  readonly brandColor: string;
  /** Capabilities this connection provides to the CEO's company. */
  readonly capabilities: readonly CapabilityDefinition[];
  /** Whether the portal can start a real connection handshake today. */
  readonly connectable?: boolean;
  /** Where configuration originates when present (e.g. "env:mautic"). */
  readonly configSourceLabel?: string;
  /** Short business description surfaced under the card title. */
  readonly descriptionEs?: string;
  readonly descriptionEn?: string;
}

export interface ConnectionInstance {
  readonly organizationId: string;
  readonly provider: string;
  readonly state: ConnectionState;
  /** When state is `connected` / `needs_attention` / `error`. */
  readonly lastCheckedAt?: string;
  readonly verifiedAt?: string;
  readonly detail?: string;
  readonly configSource?: string;
  readonly capabilities: readonly string[];
}

export interface CapabilityAvailability {
  readonly capability: string;
  readonly available: boolean;
  readonly providers: readonly string[];
}

/**
 * The canonical catalog of supported connections. Logos are simple
 * inline SVG marks — no remote URLs, no fake brand assets. Each
 * mark uses the brand's recognizable accent color.
 */
export const CONNECTION_DEFINITIONS: readonly ConnectionDefinition[] = [
  {
    id: "hostinger_email",
    name: "Correo de empresa",
    category: "email",
    categoryEs: "Correo",
    categoryEn: "Email",
    logoMark: "@",
    brandColor: "#673de6",
    capabilities: [
      { id: "email.read", nameEs: "Leer correo", nameEn: "Read email" },
      { id: "email.search", nameEs: "Buscar correos", nameEn: "Search emails" },
      { id: "email.send", nameEs: "Enviar correo", nameEn: "Send email" },
      { id: "email.reply", nameEs: "Responder correos", nameEn: "Reply to emails" },
      { id: "email.organize", nameEs: "Organizar correo", nameEn: "Organize email" },
    ],
    configSourceLabel: "env:hostinger_email_mcp",
    descriptionEs: "Tu buzón de empresa.",
    descriptionEn: "Your business mailbox.",
  },
  {
    id: "mautic",
    name: "Mautic",
    category: "crm",
    categoryEs: "CRM y automatización",
    categoryEn: "CRM and automation",
    logoMark: "M",
    brandColor: "#f36f21",
    capabilities: [
      { id: "crm.contacts.read", nameEs: "Consultar contactos", nameEn: "Read contacts" },
      { id: "crm.contacts.list", nameEs: "Listar contactos", nameEn: "List contacts" },
      { id: "crm.contacts.search", nameEs: "Buscar contactos", nameEn: "Search contacts" },
      { id: "crm.contact.read", nameEs: "Leer un contacto", nameEn: "Read one contact" },
      { id: "crm.contacts.summary", nameEs: "Resumen de contactos", nameEn: "Contacts summary" },
      { id: "crm.segments.read", nameEs: "Consultar segmentos", nameEn: "Read segments" },
      { id: "crm.campaigns.read", nameEs: "Consultar campañas", nameEn: "Read campaigns" },
      { id: "crm.activity.read", nameEs: "Actividad de un contacto", nameEn: "Contact activity" },
    ],
    configSourceLabel: "env:mautic",
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "email",
    categoryEs: "Correo",
    categoryEn: "Email",
    logoMark: "G",
    brandColor: "#ea4335",
    capabilities: [
      { id: "email.identity.read", nameEs: "Identidad del buzón", nameEn: "Mailbox identity" },
      { id: "email.context.read", nameEs: "Contexto del buzón", nameEn: "Mailbox context" },
      { id: "email.search", nameEs: "Buscar correos", nameEn: "Search emails" },
      { id: "email.thread.read", nameEs: "Leer hilos", nameEn: "Read threads" },
      { id: "email.draft", nameEs: "Crear borradores", nameEn: "Create drafts" },
      { id: "email.send.personal", nameEs: "Enviar correo personal", nameEn: "Send personal email" },
    ],
  },
  {
    id: "resend",
    name: "Email Delivery",
    category: "email",
    categoryEs: "Entrega de email",
    categoryEn: "Email Delivery",
    logoMark: "Re",
    brandColor: "#000000",
    capabilities: [
      { id: "email.send.bulk", nameEs: "Enviar campañas masivas", nameEn: "Send bulk campaigns" },
      { id: "email.delivery.read", nameEs: "Consultar entregas", nameEn: "Read deliveries" },
      { id: "email.bounce.read", nameEs: "Consultar rebotes y quejas", nameEn: "Read bounces and complaints" },
      { id: "email.campaign.read", nameEs: "Consultar campañas", nameEn: "Read campaigns" },
      { id: "email.campaign.execute", nameEs: "Ejecutar campañas", nameEn: "Execute campaigns" },
    ],
    configSourceLabel: "env:resend",
  },
  {
    id: "google_analytics",
    name: "Google Analytics",
    category: "marketing",
    categoryEs: "Analítica",
    categoryEn: "Analytics",
    logoMark: "GA",
    brandColor: "#f9ab00",
    capabilities: [
      { id: "analytics.web", nameEs: "Analítica web", nameEn: "Web analytics" },
    ],
  },
  {
    id: "google_ads",
    name: "Google Ads",
    category: "marketing",
    categoryEs: "Publicidad",
    categoryEn: "Advertising",
    logoMark: "Ads",
    brandColor: "#4285f4",
    capabilities: [
      { id: "ads.manage", nameEs: "Gestionar campañas de pago", nameEn: "Manage paid campaigns" },
    ],
  },
  {
    id: "meta_ads",
    name: "Meta Ads",
    category: "marketing",
    categoryEs: "Publicidad",
    categoryEn: "Advertising",
    logoMark: "M",
    brandColor: "#1877f2",
    capabilities: [
      { id: "ads.manage", nameEs: "Gestionar campañas de pago", nameEn: "Manage paid campaigns" },
    ],
  },
  {
    id: "meta_business",
    name: "Meta Business",
    category: "marketing",
    categoryEs: "Marketing",
    categoryEn: "Marketing",
    logoMark: "M",
    brandColor: "#1877f2",
    capabilities: [
      { id: "marketing.social.read", nameEs: "Consultar canales sociales", nameEn: "Read social channels" },
      { id: "marketing.social.publish", nameEs: "Preparar publicaciones", nameEn: "Prepare social posts" },
      { id: "ads.manage", nameEs: "Gestionar campañas de pago", nameEn: "Manage paid campaigns" },
    ],
    configSourceLabel: "oauth:meta_business",
    connectable: true,
    descriptionEs: "Facebook, Instagram y campañas de Meta, con acciones de pago sujetas a aprobación.",
    descriptionEn: "Facebook, Instagram and Meta campaigns, with paid actions subject to approval.",
  },
  {
    id: "linkedin_ads",
    name: "LinkedIn Ads",
    category: "marketing",
    categoryEs: "Publicidad",
    categoryEn: "Advertising",
    logoMark: "in",
    brandColor: "#0a66c2",
    capabilities: [
      { id: "ads.manage", nameEs: "Gestionar campañas B2B", nameEn: "Manage B2B campaigns" },
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    categoryEs: "CRM",
    categoryEn: "CRM",
    logoMark: "H",
    brandColor: "#ff7a59",
    capabilities: [
      { id: "crm.contacts.read", nameEs: "Consultar contactos", nameEn: "Read contacts" },
      { id: "marketing.campaigns.read", nameEs: "Leer campañas", nameEn: "Read campaigns" },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    category: "documents",
    categoryEs: "Documentos",
    categoryEn: "Documents",
    logoMark: "N",
    brandColor: "#000000",
    capabilities: [
      { id: "workspace.documents", nameEs: "Leer y editar documentos", nameEn: "Read & edit documents" },
    ],
  },
  // Customer Zero 03 — Google Workspace umbrella. The same OAuth
  // handshake as Gmail; surfaces Drive + Docs capabilities.
  {
    id: "google_workspace",
    name: "Google Workspace",
    category: "documents",
    categoryEs: "Documentos",
    categoryEn: "Documents",
    logoMark: "GW",
    brandColor: "#4285f4",
    capabilities: [
      { id: "drive.read", nameEs: "Leer archivos de Drive", nameEn: "Read Drive files" },
      { id: "drive.search", nameEs: "Buscar en Drive", nameEn: "Search Drive" },
    ],
  },
  // Customer Zero 03 — Google Calendar.
  {
    id: "google_calendar",
    name: "Google Calendar",
    category: "calendar",
    categoryEs: "Calendario",
    categoryEn: "Calendar",
    logoMark: "Cal",
    brandColor: "#1a73e8",
    capabilities: [
      { id: "calendar.read", nameEs: "Leer el calendario", nameEn: "Read the calendar" },
      { id: "calendar.create", nameEs: "Crear eventos", nameEn: "Create events" },
      { id: "calendar.update", nameEs: "Actualizar eventos", nameEn: "Update events" },
    ],
  },
  // Customer Zero 03 — Google Drive (standalone).
  {
    id: "google_drive",
    name: "Google Drive",
    category: "documents",
    categoryEs: "Documentos",
    categoryEn: "Documents",
    logoMark: "GD",
    brandColor: "#fbbc04",
    capabilities: [
      { id: "drive.read", nameEs: "Leer archivos de Drive", nameEn: "Read Drive files" },
      { id: "drive.search", nameEs: "Buscar en Drive", nameEn: "Search Drive" },
    ],
  },
  {
    id: "youtube",
    name: "YouTube",
    category: "marketing",
    categoryEs: "Marketing",
    categoryEn: "Marketing",
    logoMark: "▶",
    brandColor: "#ff0000",
    capabilities: [
      { id: "marketing.video.read", nameEs: "Consultar canal y vídeos", nameEn: "Read channel and videos" },
      { id: "marketing.video.prepare", nameEs: "Preparar contenido de vídeo", nameEn: "Prepare video content" },
    ],
    configSourceLabel: "oauth:google",
    connectable: true,
    descriptionEs: "Canal y datos de YouTube para preparar y analizar contenido.",
    descriptionEn: "YouTube channel and data for content preparation and analysis.",
  },
  {
    id: "ticktick",
    name: "TickTick",
    category: "team",
    categoryEs: "Equipo",
    categoryEn: "Team",
    logoMark: "✓",
    brandColor: "#4772fa",
    capabilities: [
      { id: "tasks.read", nameEs: "Consultar tareas", nameEn: "Read tasks" },
      { id: "tasks.write", nameEs: "Crear y actualizar tareas", nameEn: "Create and update tasks" },
    ],
    configSourceLabel: "oauth:ticktick",
    connectable: true,
    descriptionEs: "Seguimiento transversal de tareas y próximos pasos.",
    descriptionEn: "Cross-functional task tracking and follow-ups.",
  },
];

const DEFINITIONS_BY_ID: Readonly<Record<string, ConnectionDefinition>> = (() => {
  const map: Record<string, ConnectionDefinition> = {};
  for (const def of CONNECTION_DEFINITIONS) {
    map[def.id] = def;
  }
  return map;
})();

export function getConnectionDefinition(id: string): ConnectionDefinition | null {
  return DEFINITIONS_BY_ID[id] ?? null;
}

/** Maps the lifecycle state from `tool-state.ts` to the five business states. */
export function lifecycleToFiveState(lifecycle: ToolLifecycleStatus): ConnectionState {
  switch (lifecycle) {
    case "connected":
      return "connected";
    case "degraded":
    case "unavailable":
      return lifecycle === "unavailable" ? "error" : "needs_attention";
    case "needs_connection":
    case "configured":
    case "selected":
    default:
      return "not_connected";
  }
}

export interface ConnectionCardView {
  readonly id: string;
  readonly name: string;
  /** Localized human label for the category (e.g. "Correo"). */
  readonly category: string;
  /** Canonical category id (e.g. "email"). The portal groups by this. */
  readonly categoryId: ConnectionCategory;
  readonly logoMark: string;
  readonly brandColor: string;
  readonly state: ConnectionState;
  readonly stateLabel: string;
  readonly configSource: string | null;
  readonly verifiedAt: string | null;
  readonly capabilities: readonly CapabilityDefinition[];
  readonly actionLabel: string | null;
  /** Short business description; intentional for genuinely unknown tools. */
  readonly description: string | null;
}

/** Human label for a state in the CEO's locale. */
export function connectionStateLabel(state: ConnectionState, locale: SupportedLocale): string {
  switch (state) {
    case "not_connected":
      return t(locale, "No conectado", "Not connected");
    case "connecting":
      return t(locale, "Conectando", "Connecting");
    case "connected":
      return t(locale, "Conectado", "Connected");
    case "needs_attention":
      return t(locale, "Necesita atención", "Needs attention");
    case "error":
      return t(locale, "Error de conexión", "Connection error");
  }
}

/**
 * P0 — Intentional representation for genuinely unknown tools.
 * The CEO-declared toolId is NOT in CONNECTION_DEFINITIONS, so the
 * identity contract must be safe + explicit: never a "—" name, never
 * a blank category, never a misleading CRM default. Surface a
 * dedicated "other" bucket with a clear "no integration configured"
 * description so the CEO understands what is happening.
 */
function unknownConnectionCard(
  state: OrganizationToolState | null,
  locale: SupportedLocale,
): ConnectionCardView {
  const toolId = state?.toolId ?? "unknown";
  const label = state?.label ?? toolId;
  return {
    id: toolId,
    name: label,
    category: locale === "en" ? "Other" : "Otro",
    categoryId: "other",
    logoMark: "?",
    brandColor: "#666666",
    state: "not_connected",
    stateLabel:
      locale === "en"
        ? "Tool not mapped yet"
        : "Herramienta sin integración configurada",
    configSource: null,
    verifiedAt: null,
    capabilities: [],
    actionLabel: null,
    description:
      locale === "en"
        ? "Tool detected, integration not yet configured."
        : "Herramienta detectada, todavía sin integración configurada.",
  };
}

/**
 * Render a single connection card view from the durable organization
 * tool state. KNOWN tools (in CONNECTION_DEFINITIONS) always render a
 * complete identity. UNKNOWN tools (toolId not in the catalog) render
 * the intentional "other" representation above — never a blank card.
 */
export function renderConnectionCard(
  state: OrganizationToolState | null,
  locale: SupportedLocale,
  definition?: ConnectionDefinition,
): ConnectionCardView {
  const def = definition ?? getConnectionDefinition(state?.toolId ?? "");
  if (!def) {
    return unknownConnectionCard(state, locale);
  }
  const toolId = state?.toolId ?? def.id;
  const lifecycle: ToolLifecycleStatus = state?.status ?? "needs_connection";
  const cs: ConnectionState = lifecycleToFiveState(lifecycle);
  const actionLabel = def.connectable === false
    ? null
    : cs === "connected"
      ? t(locale, "Comprobar conexión", "Check connection")
      : cs === "needs_attention" || cs === "error"
        ? t(locale, "Revisar conexión", "Review connection")
        : def.configSourceLabel
          ? t(locale, "Activar", "Activate")
          : t(locale, "Configurar", "Set up");
  const description =
    (locale === "en" ? def.descriptionEn : def.descriptionEs) ?? null;
  return {
    id: toolId,
    name: def.name,
    category: locale === "en" ? def.categoryEn : def.categoryEs,
    categoryId: def.category,
    logoMark: def.logoMark,
    brandColor: def.brandColor,
    state: cs,
    stateLabel: connectionStateLabel(cs, locale),
    configSource: state?.configSource ?? null,
    verifiedAt: state?.verifiedAt ?? null,
    capabilities: def.capabilities,
    actionLabel,
    description,
  };
}

/**
 * Resolve the capabilities currently available to an organization,
 * aggregated across all configured connections.
 */
export function listAvailableCapabilitiesForOrg(
  states: readonly OrganizationToolState[],
): readonly CapabilityAvailability[] {
  const map = new Map<string, { available: boolean; providers: Set<string> }>();
  for (const def of CONNECTION_DEFINITIONS) {
    for (const cap of def.capabilities) {
      const slot = map.get(cap.id) ?? { available: false, providers: new Set<string>() };
      const orgState = states.find((s) => s.toolId === def.id);
      if (orgState && lifecycleToFiveState(orgState.status) === "connected") {
        slot.available = true;
        slot.providers.add(def.name);
      }
      map.set(cap.id, slot);
    }
  }
  return Array.from(map.entries()).map(([capability, slot]) => ({
    capability,
    available: slot.available,
    providers: Array.from(slot.providers),
  }));
}
