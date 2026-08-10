/**
 * Mautic Tool Definitions — Sprint 61 + Customer Zero 01.
 *
 * Registered through the canonical Tool Runtime so Mautic execution goes
 * through the full pipeline (validate → authorize → prepare → execute →
 * observe → complete). No business-layer bypass.
 *
 * Customer Zero 01 adds:
 *   - mautic.contacts.list     (paginated, no fake fixtures)
 *   - mautic.contacts.get      (single contact by id)
 *   - mautic.contacts.summary  (aggregate stats for Elvira analysis)
 *   - mautic.segments.list     (CRM segments)
 *   - mautic.campaigns.list    (CRM campaigns)
 *   - mautic.contact.activity  (per-contact activity when exposed)
 *
 * All tools use the canonical CredentialResolver so secrets never
 * appear in the LLM context or in tool arguments.
 */
import type { ToolDefinition, ToolExecutionContext } from "@departify/tool-runtime";
import {
  testMauticConnection,
  getMauticContactCount,
  searchMauticContacts,
  listMauticContacts,
  getMauticContact,
  listMauticSegments,
  listMauticCampaigns,
  getMauticContactActivity,
  getMauticSummary,
  type MauticConnectionResult,
  type MauticContactCountResult,
  type MauticContactSearchResult,
  type MauticResult,
  type CRMContactPage,
  type CRMContact,
  type CRMSegment,
  type CRMCampaign,
  type CRMActivity,
  type CRMSummary,
} from "./mautic-adapter.js";
import { resolveCredentials, getCredentials } from "./credential-resolver.js";

const MAUTIC_SCOPES = ["read.private", "execute.network"] as const;

/**
 * Internal helper: resolve credentials through CredentialResolver and
 * load them for the adapter call. Centralizes the "no secrets outside
 * the internal boundary" rule for every Mautic tool.
 */
async function loadMauticCredentials(signal: AbortSignal): Promise<
  { ok: true; baseUrl: string; clientId: string; clientSecret: string } |
  { ok: false; code: "missing" | "timeout"; message: string }
> {
  void signal;
  const resolution = resolveCredentials({ organizationId: "system", provider: "mautic" });
  if (!resolution.available || !resolution.handle) {
    return {
      ok: false,
      code: "missing",
      message:
        "Mautic no está configurado. Pídele a tu equipo de sistemas que añada MAUTIC_BASE_URL, MAUTIC_CLIENT_ID y MAUTIC_CLIENT_SECRET.",
    };
  }
  const creds = getCredentials(resolution.handle);
  if (!creds || creds.provider !== "mautic") {
    return {
      ok: false,
      code: "missing",
      message: "No se pudieron cargar las credenciales internas de Mautic.",
    };
  }
  return {
    ok: true,
    baseUrl: creds.baseUrl,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  };
}

export function createMauticTestConnectionToolDefinition(): ToolDefinition<
  void,
  MauticConnectionResult
> {
  return {
    id: "mautic.test_connection",
    version: "1.0.0",
    metadata: {
      displayName: "Mautic Connection Test",
      description:
        "Validates Mautic credentials and server connectivity through the OAuth2 client_credentials flow.",
      tags: ["mautic", "connection", "marketing"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success", "message"],
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        serverInfo: {
          type: "object",
          properties: {
            version: { type: "string" },
            name: { type: "string" },
          },
        },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      _args: void,
      signal: AbortSignal,
    ): Promise<MauticConnectionResult> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) {
        return { success: false, message: resolved.message };
      }
      return testMauticConnection(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        signal,
      );
    },
  };
}

export function createMauticContactCountToolDefinition(): ToolDefinition<
  void,
  MauticContactCountResult
> {
  return {
    id: "mautic.contacts.count",
    version: "1.0.0",
    metadata: {
      displayName: "Mautic Contact Count",
      description:
        "Returns the total number of contacts in the connected Mautic instance.",
      tags: ["mautic", "contacts", "marketing", "crm"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success", "count"],
      properties: {
        success: { type: "boolean" },
        count: { type: "number" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      _args: void,
      signal: AbortSignal,
    ): Promise<MauticContactCountResult> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) {
        return { success: false, count: 0, message: resolved.message };
      }
      return getMauticContactCount(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        signal,
      );
    },
  };
}

export function createMauticContactSearchToolDefinition(): ToolDefinition<
  { query: string },
  MauticContactSearchResult
> {
  return {
    id: "mautic.contacts.search",
    version: "1.0.0",
    metadata: {
      displayName: "Mautic Contact Search",
      description:
        "Searches contacts in the connected Mautic instance by name or email.",
      tags: ["mautic", "contacts", "marketing", "crm"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success", "count", "contacts"],
      properties: {
        success: { type: "boolean" },
        count: { type: "number" },
        contacts: { type: "array" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: { query: string },
      signal: AbortSignal,
    ): Promise<MauticContactSearchResult> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) {
        return { success: false, count: 0, contacts: [], message: resolved.message };
      }
      return searchMauticContacts(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        args.query,
        signal,
      );
    },
  };
}

/* ============================================================================
 * Customer Zero 01 — extended Mautic tools.
 * Namespaced business capabilities + normalized Departify-owned outputs.
 * ==========================================================================*/

export function createMauticContactsListToolDefinition(): ToolDefinition<
  { limit?: number; offset?: number; orderBy?: string },
  MauticResult<CRMContactPage>
> {
  return {
    id: "mautic.contacts.list",
    version: "1.0.0",
    metadata: {
      displayName: "Listar contactos",
      description:
        "Lee una página de contactos reales del CRM Mautic. Devuelve tipos normalizados Departify.",
      tags: ["mautic", "contacts", "crm", "list"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        offset: { type: "integer", minimum: 0 },
        orderBy: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        value: {
          type: "object",
          properties: {
            total: { type: "integer" },
            contacts: { type: "array" },
            nextOffset: { type: "integer" },
          },
        },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 20_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: { limit?: number; offset?: number; orderBy?: string },
      signal: AbortSignal,
    ): Promise<MauticResult<CRMContactPage>> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) return { success: false, errorCode: "auth", message: resolved.message };
      return listMauticContacts(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        args,
        signal,
      );
    },
  };
}

export function createMauticContactGetToolDefinition(): ToolDefinition<
  { contactId: number },
  MauticResult<CRMContact>
> {
  return {
    id: "mautic.contacts.get",
    version: "1.0.0",
    metadata: {
      displayName: "Obtener un contacto",
      description:
        "Lee un contacto del CRM Mautic por su identificador. Devuelve un tipo normalizado Departify.",
      tags: ["mautic", "contacts", "crm"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      required: ["contactId"],
      properties: { contactId: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        value: { type: "object" },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: { contactId: number },
      signal: AbortSignal,
    ): Promise<MauticResult<CRMContact>> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) return { success: false, errorCode: "auth", message: resolved.message };
      return getMauticContact(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        args.contactId,
        signal,
      );
    },
  };
}

export function createMauticSegmentsListToolDefinition(): ToolDefinition<
  void,
  MauticResult<readonly CRMSegment[]>
> {
  return {
    id: "mautic.segments.list",
    version: "1.0.0",
    metadata: {
      displayName: "Listar segmentos",
      description:
        "Lee todos los segmentos del CRM Mautic (listas de leads).",
      tags: ["mautic", "segments", "crm"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        value: { type: "array" },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      _args: void,
      signal: AbortSignal,
    ): Promise<MauticResult<readonly CRMSegment[]>> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) return { success: false, errorCode: "auth", message: resolved.message };
      return listMauticSegments(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        signal,
      );
    },
  };
}

export function createMauticCampaignsListToolDefinition(): ToolDefinition<
  void,
  MauticResult<readonly CRMCampaign[]>
> {
  return {
    id: "mautic.campaigns.list",
    version: "1.0.0",
    metadata: {
      displayName: "Listar campañas",
      description: "Lee todas las campañas del CRM Mautic.",
      tags: ["mautic", "campaigns", "marketing"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        value: { type: "array" },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      _args: void,
      signal: AbortSignal,
    ): Promise<MauticResult<readonly CRMCampaign[]>> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) return { success: false, errorCode: "auth", message: resolved.message };
      return listMauticCampaigns(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        signal,
      );
    },
  };
}

export function createMauticContactActivityToolDefinition(): ToolDefinition<
  { contactId: number },
  MauticResult<readonly CRMActivity[]>
> {
  return {
    id: "mautic.contact.activity",
    version: "1.0.0",
    metadata: {
      displayName: "Actividad del contacto",
      description:
        "Lee la actividad reciente de un contacto en Mautic cuando el endpoint está disponible.",
      tags: ["mautic", "contacts", "activity"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      required: ["contactId"],
      properties: { contactId: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        value: { type: "array" },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: { contactId: number },
      signal: AbortSignal,
    ): Promise<MauticResult<readonly CRMActivity[]>> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) return { success: false, errorCode: "auth", message: resolved.message };
      return getMauticContactActivity(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        args.contactId,
        signal,
      );
    },
  };
}

export function createMauticContactsSummaryToolDefinition(): ToolDefinition<
  { inactivityThresholdDays?: number },
  MauticResult<CRMSummary>
> {
  return {
    id: "mautic.contacts.summary",
    version: "1.0.0",
    metadata: {
      displayName: "Resumen de contactos",
      description:
        "Calcula un resumen agregado del CRM Mautic para análisis ejecutivo: total de contactos, segmentos, campañas y contactos sin actividad reciente.",
      tags: ["mautic", "contacts", "summary", "analytics"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: MAUTIC_SCOPES,
    inputSchema: {
      type: "object",
      properties: {
        inactivityThresholdDays: { type: "integer", minimum: 1, maximum: 365 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        value: { type: "object" },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 30_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: { inactivityThresholdDays?: number },
      signal: AbortSignal,
    ): Promise<MauticResult<CRMSummary>> => {
      const resolved = await loadMauticCredentials(signal);
      if (!resolved.ok) return { success: false, errorCode: "auth", message: resolved.message };
      return getMauticSummary(
        { baseUrl: resolved.baseUrl, clientId: resolved.clientId, clientSecret: resolved.clientSecret },
        signal,
        args,
      );
    },
  };
}
