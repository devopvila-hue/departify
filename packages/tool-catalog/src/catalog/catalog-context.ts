import type { DiscoveryReportRepository } from "@departify/business-discovery";
import type {
  LlmRouter,
  ProviderRegistry as LlmProviderRegistry,
} from "@departify/llm-router";
import type { MemoryRetrievalPort } from "@departify/memory-engine";
import type { KnowledgeRetrievalPort } from "@departify/knowledge-engine";
import type {
  Organization,
  OrganizationSnapshot,
} from "@departify/organization-domain";
import { type ToolRegistry } from "@departify/tool-runtime";

/**
 * Single composition point for the core catalog. The catalog never sources
 * state on its own; every Tool receives only what this context supplies.
 *
 * All fields are optional so hosts can wire only the Tools they need. The
 * catalog surfaces typed errors when a Tool is invoked without the context
 * data it requires.
 */
export interface CoreCatalogContext {
  readonly organizationResolver?: OrganizationResolver;
  readonly memoryRetrieval?: MemoryRetrievalPort;
  readonly knowledgeRetrieval?: KnowledgeRetrievalPort;
  readonly discoveryRepository?: DiscoveryReportRepository;
  readonly llmRouter?: LlmRouter;
  readonly llmProviderRegistry?: LlmProviderRegistry;
  readonly toolProviderRegistry?: ToolRegistry;
  readonly runtime?: {
    readonly name: string;
    readonly version: string;
    readonly environment: string;
  };
  readonly clock?: () => Date;
}

/**
 * Host-supplied lookup for the active organization. The lookup returns the
 * domain aggregate when an explicit id is supplied, or the active one when
 * none is supplied. The catalog never persists anything; this is a pure
 * function the host provides.
 */
export interface OrganizationResolver {
  resolve(input?: { organizationId?: string }): {
    organization: Organization;
    snapshot: OrganizationSnapshot;
  } | null;
}
