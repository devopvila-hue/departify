/**
 * SEO Tool Definitions — Customer Zero Golden Image.
 *
 * Registers the SEO audit + repository inspection tools through the
 * canonical Tool Runtime (validate → authorize → prepare → execute →
 * observe → complete). The actual work happens in `seo-audit.ts` and
 * `seo-repository.ts`; these definitions tell the runtime the tools
 * exist and are active, so the Department Capability Registry's
 * `isToolAvailable(toolId)` returns true.
 *
 *   departify.seo.audit          → calls auditWebsite(url)
 *   departify.seo.repository.list  → calls listGithubRepositories(org, user)
 *   departify.seo.repository.inspect → calls inspectGithubRepository(...)
 *
 * All tools are READ-ONLY. No writes, no mutations.
 */
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@departify/tool-runtime";
import { auditWebsite, type SeoAuditReport } from "./seo-audit.js";
import {
  listGithubRepositories,
  inspectGithubRepository,
  type SeoRepositorySummary,
  type SeoRepositoryLink,
  type SeoRepositoryInspection,
} from "./seo-repository.js";

const SEO_SCOPES = ["read.public", "execute.network"] as const;

interface AuditArgs {
  readonly url: string;
}

interface ListArgs {
  readonly organizationId: string;
  readonly userId: string;
}

interface InspectArgs {
  readonly organizationId: string;
  readonly userId: string;
  readonly link: SeoRepositoryLink;
  readonly issueIds?: readonly string[];
}

export function createSeoAuditToolDefinition(): ToolDefinition<
  AuditArgs,
  SeoAuditReport | { success: false; errorCode: string; message: string }
> {
  return {
    id: "departify.seo.audit",
    version: "1.0.0",
    metadata: {
      displayName: "Auditoría SEO de la web",
      description:
        "Lee la web pública y devuelve hallazgos verificables: title, description, canonical, robots, encabezados, enlaces internos rotos, imágenes sin alt, datos estructurados, metadata social y sitemap.",
      tags: ["seo", "audit", "website", "read-only"],
    },
    capabilities: ["network_access", "idempotent", "side_effect_free"],
    requiredScopes: SEO_SCOPES,
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["url", "fetchedAt", "issues", "source"],
      properties: {
        url: { type: "string" },
        fetchedAt: { type: "string" },
        issues: { type: "array" },
        source: { type: "string" },
      },
      additionalProperties: true,
    },
    limits: { timeoutMs: 15_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: AuditArgs,
      signal: AbortSignal,
    ): Promise<SeoAuditReport | { success: false; errorCode: string; message: string }> => {
      try {
        // Re-route the signal through auditWebsite's internal timeout. The
        // outer Tool Runtime abort propagates via fetch + AbortSignal.timeout.
        void signal;
        return await auditWebsite(args.url);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Audit failed.";
        return { success: false, errorCode: "seo_audit_failed", message };
      }
    },
  };
}

export function createSeoRepositoryListToolDefinition(): ToolDefinition<
  ListArgs,
  { success: true; repositories: readonly SeoRepositorySummary[] } | { success: false; errorCode: string; message: string }
> {
  return {
    id: "departify.seo.repository.list",
    version: "1.0.0",
    metadata: {
      displayName: "Listar repositorios GitHub",
      description:
        "Lista los repositorios del usuario conectado a GitHub (read-only).",
      tags: ["seo", "github", "repository", "read-only"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: SEO_SCOPES,
    inputSchema: {
      type: "object",
      required: ["organizationId", "userId"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        userId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        repositories: { type: "array" },
        errorCode: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 20_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: ListArgs,
      signal: AbortSignal,
    ) => {
      try {
        void signal;
        const repositories = await listGithubRepositories(
          args.organizationId,
          args.userId,
        );
        return { success: true, repositories };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "List failed.";
        return { success: false, errorCode: "seo_list_failed", message };
      }
    },
  };
}

export function createSeoRepositoryInspectToolDefinition(): ToolDefinition<
  InspectArgs,
  SeoRepositoryInspection | { success: false; errorCode: string; message: string }
> {
  return {
    id: "departify.seo.repository.inspect",
    version: "1.0.0",
    metadata: {
      displayName: "Inspeccionar repositorio SEO",
      description:
        "Lee el árbol del repositorio SEO seleccionado y produce file hints por hallazgo de auditoría (read-only).",
      tags: ["seo", "github", "repository", "read-only", "inspection"],
    },
    capabilities: ["network_access", "credential_aware", "idempotent", "side_effect_free"],
    requiredScopes: SEO_SCOPES,
    inputSchema: {
      type: "object",
      required: ["organizationId", "userId", "link"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        userId: { type: "string", minLength: 1 },
        link: { type: "object" },
        issueIds: { type: "array" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["repository", "files", "likelyMetadataFiles", "issueFileHints"],
      properties: {
        repository: { type: "object" },
        files: { type: "array" },
        likelyMetadataFiles: { type: "array" },
        issueFileHints: { type: "object" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 20_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: InspectArgs,
      signal: AbortSignal,
    ): Promise<SeoRepositoryInspection | { success: false; errorCode: string; message: string }> => {
      try {
        void signal;
        return await inspectGithubRepository({
          organizationId: args.organizationId,
          userId: args.userId,
          link: args.link,
          issueIds: args.issueIds ?? [],
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Inspect failed.";
        return { success: false, errorCode: "seo_inspect_failed", message };
      }
    },
  };
}

export const SEO_TOOL_DEFINITIONS: readonly ToolDefinition<unknown, unknown>[] = [
  createSeoAuditToolDefinition() as unknown as ToolDefinition<unknown, unknown>,
  createSeoRepositoryListToolDefinition() as unknown as ToolDefinition<unknown, unknown>,
  createSeoRepositoryInspectToolDefinition() as unknown as ToolDefinition<unknown, unknown>,
];