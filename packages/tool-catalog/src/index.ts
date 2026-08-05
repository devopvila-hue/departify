export {
  CORE_CATALOG_IDS,
  buildCoreCatalog,
  registerAllCoreTools,
  type CoreCatalogEntry,
  type CoreCatalogId,
  type CoreCatalogRegistration,
} from "./catalog/register-core-catalog.js";

export {
  type CoreCatalogContext,
  type OrganizationResolver,
} from "./catalog/catalog-context.js";

export {
  createSystemUuidToolDefinition,
  type SystemUuidInput,
  type SystemUuidOutput,
} from "./tools/system-uuid-tool.js";

export {
  createOrganizationGetToolDefinition,
  type OrganizationGetInput,
  type OrganizationGetOutput,
  type OrganizationGetToolOptions,
} from "./tools/organization-get-tool.js";

export {
  createMemorySearchToolDefinition,
  memorySearchErrorEnvelope,
  type MemorySearchInput,
  type MemorySearchOutput,
  type MemorySearchToolOptions,
} from "./tools/memory-search-tool.js";

export {
  createKnowledgeSearchToolDefinition,
  knowledgeSearchErrorEnvelope,
  type KnowledgeSearchInput,
  type KnowledgeSearchOutput,
  type KnowledgeSearchToolOptions,
} from "./tools/knowledge-search-tool.js";

export {
  createSystemHealthToolDefinition,
  type SystemHealthInput,
  type SystemHealthOutput,
  type SystemHealthToolOptions,
} from "./tools/system-health-tool.js";
