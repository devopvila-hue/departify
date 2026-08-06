import type { ToolDefinition } from "@departify/tool-runtime";
import { type CoreCatalogContext } from "./catalog-context.js";
import {
  createDiscoveryAnalyzeToolDefinition,
  type DiscoveryAnalyzeInput,
  type DiscoveryAnalyzeOutput,
} from "../tools/discovery-analyze-tool.js";
import {
  createDiscoveryGetToolDefinition,
  type DiscoveryGetInput,
  type DiscoveryGetOutput,
} from "../tools/discovery-get-tool.js";
import {
  createDiscoveryReadinessToolDefinition,
  type DiscoveryReadinessInput,
  type DiscoveryReadinessOutput,
} from "../tools/discovery-readiness-tool.js";
import {
  createKnowledgeSearchToolDefinition,
  type KnowledgeSearchInput,
  type KnowledgeSearchOutput,
} from "../tools/knowledge-search-tool.js";
import {
  createMemorySearchToolDefinition,
  type MemorySearchInput,
  type MemorySearchOutput,
} from "../tools/memory-search-tool.js";
import {
  createOrganizationGetToolDefinition,
  type OrganizationGetInput,
  type OrganizationGetOutput,
} from "../tools/organization-get-tool.js";
import {
  createSystemHealthToolDefinition,
  type SystemHealthInput,
  type SystemHealthOutput,
} from "../tools/system-health-tool.js";
import {
  createSystemUuidToolDefinition,
  type SystemUuidInput,
  type SystemUuidOutput,
} from "../tools/system-uuid-tool.js";

/**
 * Tool definitions registered by the catalog. Hosts iterate over this list to
 * register every Tool into their preferred `ToolRegistry` without ever having
 * to know individual tool ids.
 */
export interface CoreCatalogEntry {
  readonly id: string;
  readonly version: string;
  readonly definition: ToolDefinition;
}

export interface CoreCatalogRegistration {
  readonly entries: readonly CoreCatalogEntry[];
  readonly skipped: readonly { id: string; reason: string }[];
}

/**
 * Catalog constants — the canonical list of Tools shipped in the catalog.
 * `discovery.analyze` is added in Sprint 29.
 */
export const CORE_CATALOG_IDS = [
  "system.uuid",
  "organization.get",
  "memory.search",
  "knowledge.search",
  "system.health",
  "discovery.analyze",
  "discovery.get",
  "discovery.readiness",
] as const;

export type CoreCatalogId = (typeof CORE_CATALOG_IDS)[number];

/**
 * Builds every Tool definition supplied by the catalog, honoring the host
 * composition context. Tools whose required context is missing are skipped
 * (with a typed reason) rather than registered in a broken state.
 */
export function buildCoreCatalog(
  context: CoreCatalogContext,
): readonly ToolDefinition[] {
  const catalog: ToolDefinition[] = [];

  catalog.push(createSystemUuidToolDefinition() as unknown as ToolDefinition);

  catalog.push(
    createDiscoveryAnalyzeToolDefinition() as unknown as ToolDefinition,
  );

  if (context.discoveryRepository) {
    catalog.push(
      createDiscoveryGetToolDefinition({
        repository: context.discoveryRepository,
      }) as unknown as ToolDefinition,
    );
    catalog.push(
      createDiscoveryReadinessToolDefinition({
        repository: context.discoveryRepository,
      }) as unknown as ToolDefinition,
    );
  }

  if (context.organizationResolver) {
    catalog.push(
      createOrganizationGetToolDefinition({
        resolver: context.organizationResolver,
      }) as unknown as ToolDefinition,
    );
  }

  if (context.memoryRetrieval) {
    catalog.push(
      createMemorySearchToolDefinition({
        port: context.memoryRetrieval,
      }) as unknown as ToolDefinition,
    );
  }

  if (context.knowledgeRetrieval) {
    catalog.push(
      createKnowledgeSearchToolDefinition({
        port: context.knowledgeRetrieval,
      }) as unknown as ToolDefinition,
    );
  }

  catalog.push(
    createSystemHealthToolDefinition({
      ...(context.runtime ? { runtime: context.runtime } : {}),
      ...(context.llmProviderRegistry
        ? { llmProviderRegistry: context.llmProviderRegistry }
        : {}),
      ...(context.llmRouter
        ? {
            llmRouter: {
              defaultProviderId: context.llmRouter.getDefaultProviderId(),
            },
          }
        : {}),
      ...(context.toolProviderRegistry
        ? { toolProviderRegistry: context.toolProviderRegistry }
        : {}),
      ...(context.clock ? { clock: context.clock } : {}),
    }) as unknown as ToolDefinition,
  );

  return catalog;
}

/**
 * Registers every Tool produced by `buildCoreCatalog` into the supplied
 * `ToolRegistry`. This is the **single composition point** of the catalog.
 *
 * Hosts must call this helper exactly once during bootstrap. Manual
 * registration of catalog Tools at other call sites is prohibited by the
 * catalog's contract.
 */
export function registerAllCoreTools(
  registry: {
    register(definition: unknown): unknown;
    has(id: string, version?: string): boolean;
  },
  context: CoreCatalogContext,
): CoreCatalogRegistration {
  const definitions = buildCoreCatalog(context);
  const entries: CoreCatalogEntry[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const definition of definitions) {
    try {
      if (registry.has(definition.id, definition.version)) {
        skipped.push({
          id: definition.id,
          reason: "Tool already registered.",
        });
        continue;
      }
      registry.register(definition);
      entries.push({
        id: definition.id,
        version: definition.version,
        definition,
      });
    } catch (cause) {
      skipped.push({
        id: definition.id,
        reason:
          cause instanceof Error
            ? cause.message
            : "Unknown registration error.",
      });
    }
  }

  return { entries, skipped };
}

export type {
  SystemUuidInput,
  SystemUuidOutput,
  OrganizationGetInput,
  OrganizationGetOutput,
  MemorySearchInput,
  MemorySearchOutput,
  KnowledgeSearchInput,
  KnowledgeSearchOutput,
  SystemHealthInput,
  SystemHealthOutput,
  DiscoveryAnalyzeInput,
  DiscoveryAnalyzeOutput,
  DiscoveryGetInput,
  DiscoveryGetOutput,
  DiscoveryReadinessInput,
  DiscoveryReadinessOutput,
};
