/**
 * Capability-first tool mapping and connections — Customer Zero UX v2.
 *
 * The CEO never chooses a "plugin". He answers a business question ("¿Cómo
 * gestionas el correo?" → Gmail) and Departify decides internally which
 * capability and which connector that implies. This module is that mapping,
 * plus the honest connection state machine.
 *
 * NOTE ON REUSE (Fase 10): the repository has a Tool Runtime + Core Tool
 * Catalog abstraction (`@departify/tool-runtime`, `@departify/tool-catalog`)
 * but NO OAuth/connector infrastructure existed before this sprint. This
 * module is therefore the single, minimal connection layer: it does not
 * duplicate the tool runtime, it only records which external capability is
 * connected so Marketing can be honest about what it can and cannot do.
 */
import { t, type SupportedLocale } from "./locale.js";

export type ConnectionStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "blocked";

export interface ToolDescriptor {
  /** Stable internal id, used as the connector id. */
  readonly id: string;
  /** What the CEO calls it. */
  readonly label: string;
  /** Business capability this tool provides. */
  readonly capability: string;
  /** Category shown on the connection card ("Correo", "CRM"…). */
  readonly categoryEs: string;
  readonly categoryEn: string;
  /** Whether Departify can actually connect it (OAuth implemented). */
  readonly connectable: boolean;
  /** Environment variables required for the real OAuth handshake. */
  readonly requiredCredentials: readonly string[];
  /** Real provider authorization endpoint (used for the real handshake). */
  readonly authorizationEndpoint?: string;
  readonly scopes?: readonly string[];
}

/**
 * The tools Marketing can meaningfully use today. Deliberately small: this
 * sprint targets 1-2 real connections, not a catalog.
 */
export const TOOL_CATALOG: readonly ToolDescriptor[] = [
  {
    id: "gmail",
    label: "Gmail",
    capability: "email.send",
    categoryEs: "Correo",
    categoryEn: "Email",
    connectable: true,
    requiredCredentials: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
  },
  {
    id: "google_workspace",
    label: "Google Workspace",
    capability: "workspace.documents",
    categoryEs: "Productividad",
    categoryEn: "Productivity",
    connectable: true,
    requiredCredentials: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  },
  {
    id: "outlook",
    label: "Outlook",
    capability: "email.send",
    categoryEs: "Correo",
    categoryEn: "Email",
    connectable: true,
    requiredCredentials: ["MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET"],
    authorizationEndpoint:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    scopes: ["https://graph.microsoft.com/Mail.Send"],
  },
  {
    id: "microsoft_365",
    label: "Microsoft 365",
    capability: "workspace.documents",
    categoryEs: "Productividad",
    categoryEn: "Productivity",
    connectable: true,
    requiredCredentials: ["MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET"],
    authorizationEndpoint:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    scopes: ["https://graph.microsoft.com/Files.ReadWrite"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    capability: "messaging.direct",
    categoryEs: "Mensajería",
    categoryEn: "Messaging",
    connectable: false,
    requiredCredentials: ["WHATSAPP_BUSINESS_TOKEN"],
  },
  {
    id: "telegram",
    label: "Telegram",
    capability: "messaging.direct",
    categoryEs: "Mensajería",
    categoryEn: "Messaging",
    connectable: false,
    requiredCredentials: ["TELEGRAM_BOT_TOKEN"],
  },
  {
    id: "hubspot",
    label: "HubSpot",
    capability: "crm.contacts",
    categoryEs: "CRM",
    categoryEn: "CRM",
    connectable: false,
    requiredCredentials: ["HUBSPOT_OAUTH_CLIENT_ID", "HUBSPOT_OAUTH_CLIENT_SECRET"],
  },
  {
    id: "salesforce",
    label: "Salesforce",
    capability: "crm.contacts",
    categoryEs: "CRM",
    categoryEn: "CRM",
    connectable: false,
    requiredCredentials: ["SALESFORCE_OAUTH_CLIENT_ID", "SALESFORCE_OAUTH_CLIENT_SECRET"],
  },
  {
    id: "pipedrive",
    label: "Pipedrive",
    capability: "crm.contacts",
    categoryEs: "CRM",
    categoryEn: "CRM",
    connectable: false,
    requiredCredentials: ["PIPEDRIVE_OAUTH_CLIENT_ID", "PIPEDRIVE_OAUTH_CLIENT_SECRET"],
  },
  {
    id: "zoho",
    label: "Zoho",
    capability: "crm.contacts",
    categoryEs: "CRM",
    categoryEn: "CRM",
    connectable: false,
    requiredCredentials: ["ZOHO_OAUTH_CLIENT_ID", "ZOHO_OAUTH_CLIENT_SECRET"],
  },
];

/** Free-text / synonym resolution: the CEO's words → the internal connector. */
const ALIASES: Readonly<Record<string, string>> = {
  gmail: "gmail",
  "google mail": "gmail",
  correo: "gmail",
  google: "google_workspace",
  "google workspace": "google_workspace",
  gsuite: "google_workspace",
  "g suite": "google_workspace",
  outlook: "outlook",
  hotmail: "outlook",
  "microsoft 365": "microsoft_365",
  microsoft: "microsoft_365",
  office: "microsoft_365",
  "office 365": "microsoft_365",
  whatsapp: "whatsapp",
  telegram: "telegram",
  hubspot: "hubspot",
  salesforce: "salesforce",
  pipedrive: "pipedrive",
  zoho: "zoho",
};

/**
 * Capability-first resolution: maps whatever the CEO said/selected to a known
 * connector, or `null` when Departify has no capability for it (honest).
 */
export function resolveTool(input: string): ToolDescriptor | null {
  const key = input.trim().toLowerCase();
  if (key.length === 0) return null;
  const direct = TOOL_CATALOG.find((tool) => tool.id === key);
  if (direct) return direct;
  const aliasId = ALIASES[key];
  if (aliasId) {
    return TOOL_CATALOG.find((tool) => tool.id === aliasId) ?? null;
  }
  // Loose contains match, so "uso Gmail para todo" still resolves.
  const found = Object.keys(ALIASES).find((alias) => key.includes(alias));
  if (!found) return null;
  const id = ALIASES[found];
  return TOOL_CATALOG.find((tool) => tool.id === id) ?? null;
}

export interface ConnectionState {
  readonly toolId: string;
  readonly label: string;
  readonly capability: string;
  readonly category: string;
  status: ConnectionStatus;
  /** Why the connection cannot be completed, when status is `blocked`. */
  blockedReason?: string;
  /** Exact missing external credentials — reported, never invented. */
  missingCredentials?: readonly string[];
  /** The real provider authorization URL, when the handshake can start. */
  authorizationUrl?: string;
  connectedAt?: string;
}

export function buildConnectionState(
  tool: ToolDescriptor,
  locale: SupportedLocale,
): ConnectionState {
  return {
    toolId: tool.id,
    label: tool.label,
    capability: tool.capability,
    category: locale === "en" ? tool.categoryEn : tool.categoryEs,
    status: "not_connected",
  };
}

export interface ConnectAttemptEnv {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly redirectUri: string;
}

/**
 * Starts the REAL OAuth handshake for a connector.
 *
 * If the required external credentials are not configured we do NOT invent
 * them and we do NOT fake a connection: the connection becomes `blocked` and
 * reports exactly which credential is missing.
 */
export function startConnection(
  connection: ConnectionState,
  tool: ToolDescriptor,
  options: ConnectAttemptEnv,
  locale: SupportedLocale,
): ConnectionState {
  if (!tool.connectable || !tool.authorizationEndpoint) {
    connection.status = "blocked";
    connection.blockedReason = t(
      locale,
      `Departify todavía no puede conectar ${tool.label}.`,
      `Departify cannot connect ${tool.label} yet.`,
    );
    connection.missingCredentials = tool.requiredCredentials;
    return connection;
  }

  const missing = tool.requiredCredentials.filter(
    (name) => !options.env[name] || options.env[name]?.trim().length === 0,
  );
  if (missing.length > 0) {
    connection.status = "blocked";
    connection.blockedReason = t(
      locale,
      `Falta la credencial externa para conectar ${tool.label}.`,
      `The external credential to connect ${tool.label} is missing.`,
    );
    connection.missingCredentials = missing;
    return connection;
  }

  const clientId = options.env[tool.requiredCredentials[0] as string] as string;
  const url = new URL(tool.authorizationEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("scope", (tool.scopes ?? []).join(" "));

  connection.status = "connecting";
  connection.authorizationUrl = url.toString();
  delete connection.blockedReason;
  delete connection.missingCredentials;
  return connection;
}

/** Completes a handshake with a real provider callback code. */
export function completeConnection(
  connection: ConnectionState,
  now: Date = new Date(),
): ConnectionState {
  connection.status = "connected";
  connection.connectedAt = now.toISOString();
  delete connection.authorizationUrl;
  return connection;
}
