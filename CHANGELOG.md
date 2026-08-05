# Changelog

## [Unreleased]

### Added

- ROSA adoption.
- Golden Image foundation with Docker backend image, compose file, Railway config, Netlify portal config, Supabase CLI config, centralized typed configuration, and environment variable contract.
- Provisioning Engine foundation with public contracts, pipeline phase definitions, explicit state model, validation primitives, adapter ports, and unit tests.
- Organization Domain foundation with canonical aggregate root, value objects, lifecycle policy, domain events, pure invariants, and unit tests.
- Application Layer foundation with commands, queries, handlers, DTOs, mappers, application services, ports, validation, and unit tests.
- Persistence Contracts foundation with repository contracts, unit of work, transactions, specifications, pagination, filters, optimistic locking, provider-neutral errors, and unit tests.
- Supabase Persistence Adapter with official Supabase client configuration, repository implementations, snapshot mappers, local migration, UnitOfWork adapter, unit tests, and local integration tests.
- Platform Composition foundation with the first real organization provisioning flow persisted through Supabase local, plus repeatable end-to-end coverage.
- Agent Runtime foundation with provider-independent registry, lifecycle state policy, permissions, internal messaging contracts, scheduling contracts, runtime events, validation, and unit tests.
- Agent Domain foundation with canonical aggregate root, value objects, lifecycle policy, domain events, pure invariants, and unit tests for digital employees.
- Executive Director foundation with intents, routing, planning, decision model, coordination contracts, internal events, validation, and unit tests.
- LLM Router foundation with provider-neutral contracts, capabilities, abstract model catalog, routing policies, requests, responses, validation, and unit tests.
- OpenAI LLM Provider Adapter foundation with official SDK isolation, typed configuration through `packages/config`, request/response mappers, chat/completion/structured-output/tool-calling/streaming support, unit tests, and live integration test wiring.
- Memory Engine foundation with memory records, context assembly, sessions, retention policies, retrieval contracts, lifecycle rules, internal events, validation, and unit tests.
- Knowledge Engine foundation with documents, chunks, sources, collections, scopes, abstract indexing, retrieval contracts, ranking policies, lifecycle rules, internal events, validation, and unit tests.
- LLM Router composition with official `bootstrapLlmRouter` entry point, internal `ProviderRegistry`, provider-agnostic observability (`RouterLogger`, `RouterMetrics`, `InMemoryRouterMetrics`, `createNoopObservability`, `createConsoleObservability`, `createInMemoryObservability`), routing policies `capability_first` and `balanced` plus the existing strategies, configuration-driven default provider and strategy via `packages/config` (`LLM_DEFAULT_PROVIDER`, `LLM_ROUTING_STRATEGY`), `LlmRouter` facade exposing `chat`, `complete`, `embed`, and `stream`, and a registry bridge in `packages/llm-provider-openai` (`registerOpenAIProvider`).
- Multi-provider foundation with `packages/llm-provider-google` (Google Vertex AI / Gemini), `packages/llm-provider-minimax` (OpenAI-compatible HTTP), `packages/llm-provider-bridge` (the single multi-provider composition entry point), typed configuration via `packages/config` for `GOOGLE_VERTEX_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `MINIMAX_*` plus a typed enum for `LLM_DEFAULT_PROVIDER`, an expanded `LLM_DEFAULT_PROVIDER` enum (`openai`, `google_vertex`, `minimax`), and unit + integration tests for every new provider.
