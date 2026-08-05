# Core Tool Catalog

Official Departify catalog of Tools. The catalog is the single composition point for the platform's baseline Tools:

- `system.uuid` — generate UUIDs.
- `organization.get` — read the active organization snapshot through `packages/organization-domain`.
- `memory.search` — call `MemoryRetrievalPort` from `packages/memory-engine`. No IA, no embeddings.
- `knowledge.search` — call `KnowledgeRetrievalPort` from `packages/knowledge-engine`. No vector search.
- `system.health` — surface a typed health summary (runtime + tool runtime + router + provider registry + version + timestamp).

All Tools register through `registerAllCoreTools(registry, context)` — the single composition point.

The catalog never creates new runtimes, bridges, packages, HTTP clients or SDKs. It depends only on contracts that already exist in the platform.
