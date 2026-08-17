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

/** How the current product obtains a provider connection. */
export type ConnectionMethod =
  | "oauth"
  | "manual"
  | "platform_managed"
  | "not_configured";

export type CredentialFieldType = "text" | "url" | "password";

export interface CredentialFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: CredentialFieldType;
  readonly placeholder?: string;
  readonly secret?: boolean;
  readonly helpText?: string;
}

/** Safe, build-time metadata for a customer-owned credential flow. */
export interface CredentialHelpDefinition {
  readonly whatYouNeed: string;
  readonly steps: readonly string[];
  readonly fields: readonly CredentialFieldDefinition[];
  readonly actionLabel: string;
  readonly actionUrl: string;
  readonly docsUrl?: string;
  readonly note?: string;
}

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
  /** Connection path; never inferred from customer credentials in the UI. */
  readonly connectionMethod?: ConnectionMethod;
  /** Where configuration originates when present (e.g. "env:mautic"). */
  readonly configSourceLabel?: string;
  /** Short business description surfaced under the card title. */
  readonly descriptionEs?: string;
  readonly descriptionEn?: string;
  /** Customer-owned setup instructions, never used for platform secrets. */
  readonly credentialHelp?: CredentialHelpDefinition;
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
    id: "github_repository",
    name: "GitHub",
    category: "marketing",
    categoryEs: "Proyecto web",
    categoryEn: "Web project",
    logoMark: "GH",
    brandColor: "#24292f",
    capabilities: [
      { id: "repository.read", nameEs: "Leer el proyecto web", nameEn: "Read the web project" },
      { id: "repository.write", nameEs: "Preparar cambios autorizados", nameEn: "Prepare authorized changes" },
    ],
    configSourceLabel: "oauth:github",
    connectionMethod: "oauth",
    connectable: true,
    descriptionEs: "Conecta el proyecto donde está publicada tu web para localizar y preparar correcciones.",
    descriptionEn: "Connect the project hosting your website to locate and prepare fixes.",
  },
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
    connectionMethod: "platform_managed",
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
    connectionMethod: "platform_managed",
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
    connectionMethod: "platform_managed",
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
    descriptionEs: "Consulta la analítica web de tu negocio.",
    descriptionEn: "Read your business web analytics.",
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
      { id: "marketing.google.ads.read", nameEs: "Consultar campañas", nameEn: "Read campaigns" },
      { id: "marketing.google.ads.report", nameEs: "Consultar rendimiento", nameEn: "Read performance" },
      { id: "marketing.google.ads.analyze", nameEs: "Analizar campañas", nameEn: "Analyze campaigns" },
    ],
    descriptionEs: "Analiza tus campañas de Google Ads. Las modificaciones requieren una conexión de gestión autorizada.",
    descriptionEn: "Analyze your Google Ads campaigns. Changes require an authorized management connection.",
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
      { id: "marketing.meta.ads.read", nameEs: "Consultar campañas", nameEn: "Read campaigns" },
      { id: "marketing.meta.ads.report", nameEs: "Consultar rendimiento", nameEn: "Read performance" },
      { id: "marketing.meta.ads.analyze", nameEs: "Analizar campañas", nameEn: "Analyze campaigns" },
      { id: "marketing.meta.ads.create", nameEs: "Preparar campañas", nameEn: "Prepare campaigns" },
      { id: "marketing.meta.ads.manage", nameEs: "Gestionar campañas", nameEn: "Manage campaigns" },
      { id: "marketing.meta.ads.pause", nameEs: "Pausar campañas", nameEn: "Pause campaigns" },
      { id: "marketing.meta.ads.resume", nameEs: "Reactivar campañas", nameEn: "Resume campaigns" },
      { id: "marketing.meta.ads.budget.manage", nameEs: "Gestionar presupuesto", nameEn: "Manage budget" },
      { id: "marketing.meta.ads.audience.manage", nameEs: "Gestionar audiencias", nameEn: "Manage audiences" },
      { id: "marketing.meta.ads.creative.manage", nameEs: "Gestionar creatividades", nameEn: "Manage creatives" },
    ],
    connectable: true,
    descriptionEs: "Gestiona campañas, rendimiento y publicidad de Facebook e Instagram.",
    descriptionEn: "Manage Facebook and Instagram campaigns and performance.",
  },
  {
    id: "tiktok_ads",
    name: "TikTok Ads",
    category: "marketing",
    categoryEs: "Publicidad",
    categoryEn: "Advertising",
    logoMark: "♪",
    brandColor: "#111111",
    capabilities: [
      { id: "marketing.tiktok.ads.read", nameEs: "Consultar campañas", nameEn: "Read campaigns" },
      { id: "marketing.tiktok.ads.report", nameEs: "Consultar rendimiento", nameEn: "Read performance" },
      { id: "marketing.tiktok.ads.analyze", nameEs: "Analizar campañas", nameEn: "Analyze campaigns" },
      { id: "marketing.tiktok.ads.create", nameEs: "Preparar campañas", nameEn: "Prepare campaigns" },
      { id: "marketing.tiktok.ads.manage", nameEs: "Gestionar campañas", nameEn: "Manage campaigns" },
      { id: "marketing.tiktok.ads.pause", nameEs: "Pausar campañas", nameEn: "Pause campaigns" },
      { id: "marketing.tiktok.ads.resume", nameEs: "Reactivar campañas", nameEn: "Resume campaigns" },
      { id: "marketing.tiktok.ads.budget.manage", nameEs: "Gestionar presupuesto", nameEn: "Manage budget" },
      { id: "marketing.tiktok.ads.audience.manage", nameEs: "Gestionar audiencias", nameEn: "Manage audiences" },
      { id: "marketing.tiktok.ads.creative.manage", nameEs: "Gestionar creatividades", nameEn: "Manage creatives" },
    ],
    descriptionEs: "Gestiona campañas y rendimiento en TikTok.",
    descriptionEn: "Manage campaigns and performance on TikTok.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    category: "marketing",
    categoryEs: "Marketing",
    categoryEn: "Marketing",
    logoMark: "♪",
    brandColor: "#111111",
    capabilities: [
      { id: "marketing.tiktok", nameEs: "Catálogo de TikTok", nameEn: "TikTok catalog" },
    ],
    descriptionEs: "Canal de TikTok identificado en el catálogo.",
    descriptionEn: "TikTok channel identified in the catalog.",
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
    ],
    configSourceLabel: "oauth:meta_business",
    connectionMethod: "oauth",
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
    id: "microsoft_365",
    name: "Microsoft 365",
    category: "documents",
    categoryEs: "Documentos",
    categoryEn: "Documents",
    logoMark: "365",
    brandColor: "#737373",
    capabilities: [
      { id: "workspace.documents", nameEs: "Consultar documentos", nameEn: "Read documents" },
    ],
    descriptionEs: "Documentos y archivos de Microsoft 365.",
    descriptionEn: "Microsoft 365 documents and files.",
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    category: "email",
    categoryEs: "Correo",
    categoryEn: "Email",
    logoMark: "M",
    brandColor: "#ffe01b",
    capabilities: [
      { id: "email.send", nameEs: "Preparar campañas de email", nameEn: "Prepare email campaigns" },
    ],
    descriptionEs: "Campañas de email y audiencias de Mailchimp.",
    descriptionEn: "Mailchimp email campaigns and audiences.",
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
      { id: "drive.create_folder", nameEs: "Crear carpetas", nameEn: "Create folders" },
      { id: "drive.create_file", nameEs: "Crear documentos", nameEn: "Create documents" },
      { id: "drive.write", nameEs: "Actualizar documentos", nameEn: "Update documents" },
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
  {
    id: "microsoft_calendar",
    name: "Microsoft Outlook Calendar",
    category: "calendar",
    categoryEs: "Calendario",
    categoryEn: "Calendar",
    logoMark: "Cal",
    brandColor: "#0078d4",
    capabilities: [
      { id: "calendar.read", nameEs: "Consultar el calendario", nameEn: "Read the calendar" },
    ],
    descriptionEs: "Calendario de Microsoft Outlook.",
    descriptionEn: "Microsoft Outlook calendar.",
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
      { id: "drive.create_folder", nameEs: "Crear carpetas", nameEn: "Create folders" },
      { id: "drive.create_file", nameEs: "Crear documentos", nameEn: "Create documents" },
      { id: "drive.write", nameEs: "Actualizar documentos", nameEn: "Update documents" },
    ],
  },
  {
    id: "dropbox",
    name: "Dropbox",
    category: "documents",
    categoryEs: "Documentos",
    categoryEn: "Documents",
    logoMark: "◇",
    brandColor: "#0061ff",
    capabilities: [
      { id: "workspace.documents", nameEs: "Consultar archivos", nameEn: "Read files" },
    ],
    descriptionEs: "Archivos y documentos de Dropbox.",
    descriptionEn: "Dropbox files and documents.",
  },
  {
    id: "brevo",
    name: "Brevo",
    category: "email",
    categoryEs: "Correo",
    categoryEn: "Email",
    logoMark: "B",
    brandColor: "#0b996e",
    capabilities: [
      { id: "email.send", nameEs: "Preparar campañas de email", nameEn: "Prepare email campaigns" },
    ],
    descriptionEs: "Campañas de email y automatización de Brevo.",
    descriptionEn: "Brevo email campaigns and automation.",
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
    connectionMethod: "oauth",
    connectable: true,
    descriptionEs: "Canal y datos de YouTube para preparar y analizar contenido.",
    descriptionEn: "YouTube channel and data for content preparation and analysis.",
  },
  {
    id: "wordpress",
    name: "WordPress",
    category: "marketing",
    categoryEs: "Marketing",
    categoryEn: "Marketing",
    logoMark: "W",
    brandColor: "#21759b",
    capabilities: [
      { id: "marketing.wordpress.site.read", nameEs: "Consultar el sitio", nameEn: "Read site" },
      { id: "marketing.wordpress.posts.list", nameEs: "Consultar publicaciones", nameEn: "Read posts" },
      { id: "marketing.wordpress.posts.get", nameEs: "Leer una publicación", nameEn: "Read a post" },
      { id: "marketing.wordpress.posts.create", nameEs: "Preparar publicaciones", nameEn: "Prepare posts" },
      { id: "marketing.wordpress.posts.update", nameEs: "Actualizar publicaciones", nameEn: "Update posts" },
      { id: "marketing.wordpress.categories.list", nameEs: "Consultar categorías", nameEn: "Read categories" },
      { id: "marketing.wordpress.tags.list", nameEs: "Consultar etiquetas", nameEn: "Read tags" },
    ],
    connectable: true,
    connectionMethod: "manual",
    descriptionEs: "Consulta y prepara publicaciones de tu sitio WordPress.",
    descriptionEn: "Read and prepare posts on your WordPress site.",
    credentialHelp: {
      whatYouNeed: "La URL HTTPS de tu sitio, un usuario de WordPress y una contraseña de aplicación.",
      steps: [
        "Entra en wp-admin con el usuario que hará la conexión.",
        "Ve a Usuarios → Perfil.",
        "En Contraseñas de aplicación, crea una contraseña para Departify.",
        "Copia la contraseña: WordPress solo la muestra una vez.",
        "Vuelve aquí y pega los datos para comprobar la conexión.",
      ],
      fields: [
        { id: "websiteUrl", label: "Dirección del sitio", type: "url", placeholder: "https://tu-sitio.com" },
        { id: "username", label: "Usuario", type: "text", placeholder: "admin" },
        { id: "password", label: "Contraseña de aplicación", type: "password", secret: true, placeholder: "xxxx xxxx xxxx xxxx" },
      ],
      actionLabel: "Abrir guía oficial ↗",
      actionUrl: "https://developer.wordpress.org/advanced-administration/security/application-passwords/",
      note: "Usa una contraseña de aplicación, no la contraseña principal de WordPress.",
    },
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "marketing",
    categoryEs: "Marketing",
    categoryEn: "Marketing",
    logoMark: "S",
    brandColor: "#95bf47",
    capabilities: [
      { id: "marketing.shopify.shop.read", nameEs: "Consultar la tienda", nameEn: "Read shop" },
      { id: "marketing.shopify.products.list", nameEs: "Consultar productos", nameEn: "Read products" },
      { id: "marketing.shopify.products.get", nameEs: "Leer un producto", nameEn: "Read a product" },
      { id: "marketing.shopify.orders.list", nameEs: "Consultar pedidos", nameEn: "Read orders" },
      { id: "marketing.shopify.orders.get", nameEs: "Leer un pedido", nameEn: "Read an order" },
      { id: "marketing.shopify.customers.list", nameEs: "Consultar clientes", nameEn: "Read customers" },
      { id: "marketing.shopify.products.create", nameEs: "Preparar productos", nameEn: "Prepare products" },
      { id: "marketing.shopify.products.update", nameEs: "Actualizar productos", nameEn: "Update products" },
    ],
    connectable: true,
    connectionMethod: "manual",
    descriptionEs: "Consulta y prepara productos de tu tienda Shopify.",
    descriptionEn: "Read and prepare products in your Shopify store.",
    credentialHelp: {
      whatYouNeed: "El subdominio de tu tienda y un token Admin API de una app personalizada compatible.",
      steps: [
        "Si ya tienes una app personalizada creada antes del cambio de Shopify, abre su configuración.",
        "Copia el token Admin API de esa app.",
        "Escribe el subdominio de tu tienda, sin https:// ni .myshopify.com.",
        "Vuelve aquí y pega el token para comprobar la conexión.",
      ],
      fields: [
        { id: "shopName", label: "Nombre de la tienda", type: "text", placeholder: "mi-tienda" },
        { id: "adminToken", label: "Token Admin API", type: "password", secret: true, placeholder: "shpat_…" },
      ],
      actionLabel: "Abrir guía oficial ↗",
      actionUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
      note: "Las apps nuevas del Dev Dashboard usan un intercambio de token distinto. Esta conexión acepta actualmente tokens Admin API de apps personalizadas compatibles.",
    },
  },
  {
    id: "etsy",
    name: "Etsy",
    category: "marketing",
    categoryEs: "Marketing",
    categoryEn: "Marketing",
    logoMark: "E",
    brandColor: "#f1641e",
    capabilities: [
      { id: "marketing.etsy.listings.read", nameEs: "Consultar catálogo", nameEn: "Read listings" },
    ],
    descriptionEs: "Conector identificado; requiere configuración antes de poder conectarlo.",
    descriptionEn: "Connector identified; configuration is required before it can connect.",
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
      const capabilityGranted = orgState?.grantedCapabilities?.includes(cap.id) ?? false;
      if (
        orgState &&
        lifecycleToFiveState(orgState.status) === "connected" &&
        capabilityGranted
      ) {
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
