/**
 * Mautic Tool Definitions — Sprint 61.
 *
 * Registered through the canonical Tool Runtime so Mautic execution goes
 * through the full pipeline (validate → authorize → prepare → execute →
 * observe → complete). No business-layer bypass.
 */
import type { ToolDefinition, ToolExecutionContext } from "@departify/tool-runtime";
import {
  testMauticConnection,
  getMauticContactCount,
  searchMauticContacts,
  type MauticConnectionResult,
  type MauticContactCountResult,
  type MauticContactSearchResult,
} from "./mautic-adapter.js";

const MAUTIC_SCOPES = ["read.private", "execute.network"] as const;

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
      const { resolveMauticCredentials } = await import(
        "./mautic-adapter.js"
      );
      const creds = resolveMauticCredentials();
      if (!creds) {
        return {
          success: false,
          message:
            "Mautic credentials are not configured. Set MAUTIC_BASE_URL, MAUTIC_CLIENT_ID, and MAUTIC_CLIENT_SECRET.",
        };
      }
      return testMauticConnection(creds, signal);
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
      const { resolveMauticCredentials } = await import(
        "./mautic-adapter.js"
      );
      const creds = resolveMauticCredentials();
      if (!creds) {
        return { success: false, count: 0, message: "Mautic credentials not configured." };
      }
      return getMauticContactCount(creds, signal);
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
      const { resolveMauticCredentials } = await import(
        "./mautic-adapter.js"
      );
      const creds = resolveMauticCredentials();
      if (!creds) {
        return { success: false, count: 0, contacts: [], message: "Mautic credentials not configured." };
      }
      return searchMauticContacts(creds, args.query, signal);
    },
  };
}
