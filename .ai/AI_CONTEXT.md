# AI Context

## Repository identity

Name: departify
Type: monorepo
ROSA: 1.0.2
Official ROSA repository: https://github.com/devopvila-hue/rosa

## Purpose

Departify V2 is a new ROSA-governed SaaS AI-first platform. The current repository state is a Golden Image foundation: monorepo structure, portal runtime, backend runtime, centralized configuration, official provider CLI setup, and Docker-first execution.

The Golden Image installs the platform. It does not create organizations, agents, memory, RAG, plugins, workflows, or business APIs.

`packages/provisioning-engine` is the only authorized boundary for future organization creation. Its current state is contract and state-model foundation only; it must not create agents, execute AI, provision RAG, register plugins, or call external services.

`packages/organization-domain` is the canonical domain model for an organization. It is pure TypeScript domain code and must not import provider SDKs, read environment variables, or know about persistence, Docker, Railway, Netlify, Supabase, OpenClaw, agents, AI, RAG, plugins, or workflows.

`packages/application` is the official application orchestration layer. It defines commands, queries, handlers, DTOs, mappers, validation, application services, and ports. It coordinates `packages/organization-domain` and `packages/provisioning-engine` through contracts only and must not contain domain rules, infrastructure, persistence, transport code, provider SDKs, or environment access.

`packages/persistence-contracts` is the official provider-independent persistence contract layer. It defines repositories, unit of work, transaction contracts, specifications, pagination, filters, optimistic locking, and persistence errors. It must not contain adapters, storage implementations, schemas, migrations, provider SDKs, or environment access.

`packages/persistence-supabase` is the first concrete persistence adapter. It implements the persistence contracts with `@supabase/supabase-js`, maps domain/provisioning snapshots to Supabase record tables, and obtains config through `packages/config` types only. It must not modify domain, application, provisioning, or persistence contracts.

`packages/platform-composition` is the official package wiring boundary. It connects Application Layer, Provisioning Engine, Organization Domain, Persistence Contracts, and Supabase Adapter for the first real provisioning flow. It must not redefine contracts or introduce APIs, auth, portal, agents, RAG, memory, plugins, or workflows.

`packages/agent-runtime` is the proprietary runtime boundary for managing Departify digital employees. It owns registry operations, lifecycle states, permission primitives, internal message contracts, scheduling contracts, state validation, and runtime events. It must not execute AI models, call model providers, implement the LLM Router, implement the Executive Director, expose HTTP/Fastify APIs, use external queues, access infrastructure directly, or read environment variables.

`packages/agent-domain` is the canonical domain model for a Departify digital employee. It owns the Agent aggregate, value objects, lifecycle policy, domain events, and pure invariants. It must not depend on Agent Runtime, Provisioning Engine, persistence, Supabase, APIs, transport, provider SDKs, integrations, model execution, or environment variables.

`packages/executive-director` is the provider-independent orchestration boundary for the digital company. It evaluates intents, routes them conceptually, creates decisions, emits internal events, and models coordination contracts toward Application Layer, Provisioning Engine, and Agent Runtime. It must not execute AI, implement the LLM Router, persist data, call providers, expose transport APIs, run agents, or access environment variables. As of Sprint 23 it is the deterministic decision engine used by `packages/executive-orchestrator` to route orchestrator intents to runtime Tools.

`packages/executive-orchestrator` is the official composition boundary that wires Executive Director into the runtime flow. It defines `OrchestratorIntent` types (`health_check`, `organization_summary`, `generate_identifier`, `discovery_analyze`), the `ExecutiveDecisionMapper` (the only component authorised to translate `ExecutiveDecision` into `AgentToolAction`), and the `ExecutiveOrchestrator` facade that drives the pipeline `OrchestratorIntent → ExecutiveDirector → DecisionMapper → AgentToolBridge → Tool Runtime → Core Tool Catalog`. Sprint 30 adds `discovery_analyze`, which dispatches to the `discovery.analyze` Core Tool through the same pipeline, with dynamic Tool args carried on the intent's `toolArgs` slot. It preserves the full correlation chain (intentId → decisionId → actionId) inside the `OrchestrationResult` envelope. The orchestrator depends only on public contracts of Executive Director, AgentToolBridge, Agent Runtime, Tool Runtime and Tool Catalog; it never modifies them. No IA, no LLM Router, no HTTP, no SDKs, no Fastify, no Supabase, no Docker, no plugins, no MCP.

`packages/departments` is the **external product unit** (Sprint 24). A Department composes references to existing components: Executive Director (director), Agent Runtime (digital employees), Tool Runtime + Core Tool Catalog (tools), Knowledge Engine (knowledge collections), Memory Engine (memory sessions) and a placeholder for connected applications. It owns identity, configuration, lifecycle states (`draft`, `active`, `paused`, `archived`), metrics and an event taxonomy (`department.created`, `department.activated`, `department.employee_added`, `department.tool_associated`, etc.). The Department never duplicates logic — it only carries references. Sprint 24 ships the canonical `Comercial` demo department with four Digital Employees (`agent_sales_director`, `agent_lead_qualifier`, `agent_outreach_specialist`, `agent_proposal_writer`) and pre-associated Tools, Knowledge Collections and Memory Sessions. The package must not import provider SDKs, read environment variables, perform HTTP calls, depend on the LLM Router, or contain IA.

**External vs internal naming.** The **Department** is the visible unit of the product (the customer-facing language). The **Digital Employee** — modelled by `packages/agent-runtime` and `packages/agent-domain` — is the internal execution unit. A Department contains one or more Digital Employees; a Digital Employee belongs to exactly one Department. The two languages must never be mixed.

`packages/provisioning-engine` is the only authorized boundary for future organization creation. Its current state is contract and state-model foundation only; it must not create agents, execute AI, provision RAG, register plugins, or call external services. As of Sprint 25 it adds the `instantiate_business` pipeline step and a typed `BusinessProvisioningResult` envelope so hosts can compose the canonical Department template after the Organization is persisted.

`packages/llm-router` is the only authorized boundary for future AI model access. It defines provider-neutral contracts for chat, completion, embeddings, tool calling, streaming, and structured output, plus capability modeling, abstract model descriptors, routing policies, request/response validation, and model selection decisions. No other package may import provider SDKs or call models directly. Its current state must not include provider implementations, product prompts, API keys, external calls, or environment access. As of Sprint 18 it is the only operational entry point for AI access: it ships an internal `ProviderRegistry`, a `ProviderSelector` for routing decisions, a provider-agnostic observability surface, and the official `LlmRouter` facade exposing `chat`, `complete`, `embed`, and `stream`. All other packages (Executive Director, Agent Runtime, applications) must talk to this facade and to it alone. The router is provider-agnostic: Sprint 19 added OpenAI, Google Vertex and MiniMax adapters behind the same `ProviderRegistry` without modifying the router.

`packages/llm-provider-openai` is the first concrete LLM Router provider adapter. It is the only package authorized to import the official OpenAI SDK. It implements existing `packages/llm-router` contracts, maps router requests/responses to OpenAI SDK calls internally, and obtains OpenAI configuration exclusively through `packages/config`. It must not expose SDK types, modify router contracts, connect to Executive Director, Agent Runtime, Memory Engine, Knowledge Engine, plugins, RAG, n8n, HTTP APIs, or contain product prompts/business logic. It exposes `registerOpenAIProvider` for use by the LLM Router composition; the provider never registers itself autonomously.

`packages/llm-provider-google` is the official Google Vertex AI (Gemini) adapter. It is the only package authorized to import `@google-cloud/vertexai`. It implements the existing `packages/llm-router` contracts, maps requests/responses to Vertex AI SDK calls internally, and consumes configuration exclusively through `packages/config`. It exposes `registerGoogleVertexProvider` and never registers itself autonomously.

`packages/llm-provider-minimax` is the official MiniMax adapter. It uses the OpenAI SDK with a custom `baseURL` so it never imports a MiniMax-specific SDK. It implements the existing `packages/llm-router` contracts and consumes configuration exclusively through `packages/config`. It exposes `registerMiniMaxProvider` and never registers itself autonomously.

`packages/llm-provider-bridge` is the official multi-provider composition boundary. It is the only place in the system that names providers, and it depends on every provider adapter plus the router. It exposes `registerAllProviders(registry)` which delegates to each adapter's `registerXProvider` helper. The bridge is provider-agnostic in shape (one pipeline step per provider) but is the single boundary responsible for assembling the registry at runtime.

`packages/tool-runtime` is the only authorized boundary for executing Tools. It defines the Tool domain model (`Tool`, `ToolDefinition`, `ToolExecutionRequest`, `ToolExecutionResult`, `ToolExecutionContext`, `ToolCapability`, `ToolMetadata`, scopes and capabilities), the explicit `ToolRegistry` (`register`, `unregister`, `get`, `has`, `list`, `validate`), the six-phase execution pipeline (`validate → authorize → prepare → execute → observe → complete`), permissions, isolation, timeout, cancellation and limits policies, a provider-agnostic observability surface (`ToolLogger`, `ToolMetrics`, `InMemoryToolMetrics`, `NoopTool*`), and the internal event taxonomy (`tool.registered`, `tool.requested`, `tool.started`, `tool.completed`, `tool.failed`, `tool.cancelled`). Sprint 20 ships the foundation only — real execution is disabled. Tool Runtime must not import provider SDKs, read environment variables, perform HTTP calls, expose Fastify/Supabase/Docker integrations, depend on Executive Director, Agent Runtime, Memory Engine, Knowledge Engine, RAG or plugins, or contain product prompts. Future sprints will plug real isolation backends and concrete executors through the same contracts.

`packages/agent-tool-bridge` is the official composition boundary between Agent Runtime and Tool Runtime. It owns the `AgentToolPort` interface — the only contract Agent Runtime uses to invoke Tools — and the `AgentToolRuntimeAdapter`, which translates `AgentToolAction` into `ToolExecutionRequest` and back. It also ships the `system.time` demonstration Tool (pure local computation, no HTTP, no external services). Sprint 21 is the first runtime-to-runtime integration: an Agent registered through `AgentRegistry` invokes Tools through the Port and the Tool Runtime executes them. The bridge never modifies either runtime; it composes them. No IA, no LLM Router, no Executive Director, no Memory Engine, no Knowledge Engine, no plugins, no MCP, no HTTP, no external services.

`packages/workflows` is the first Department collaboration layer. It owns `WorkflowDefinition`, `WorkflowStep`, `WorkflowExecution`, `WorkflowResult`, `WorkflowBuilder` and the canonical `Lead Qualification Workflow` (`wf_lead_qualification`). Workflows are pure composition over `AgentToolBridge` and `Tool Runtime`; the execution engine dispatches each step through the bridge (one Digital Employee per step) and threads the previous step's output into the next step's metadata. Sprint 26 ships the Comercial workflow with three steps (Qualify Lead, Prepare Contact, Generate Proposal) executed by `agent_lead_qualifier`, `agent_outreach_specialist` and `agent_proposal_writer`. The Department aggregate tracks the workflow ids attached to it; no logic duplication. No IA, no LLM Router, no HTTP, no SDKs, no Fastify, no Supabase, no Docker.

`packages/business-events` is the official event-driven composition layer. It owns `BusinessEvent` (with three typed event types: `lead.created`, `organization.created`, `organization.provisioned`), the `BusinessEventCatalog` (the only authorised source for event → handler mapping) and the `BusinessEventService` that publishes events through the catalog. The service never executes business logic directly; every handler delegates to an existing runtime (`WorkflowExecution`, `BusinessProvisioningService`, `ExecutiveOrchestrator`). Results are idempotent by eventId and carry the full correlation chain (eventId, workflowId, executionId, provisioningId, timestamps, errors). No reflection, no dynamic discovery, no IA, no LLM Router, no HTTP, no SDKs, no Fastify, no Supabase, no Docker. Sprint 27 ships three default handlers.

`packages/tool-catalog` is the official catalog of core Tools. It owns six Tool definitions: `system.uuid` (uuid + version), `organization.get` (reads the active organization through `packages/organization-domain`), `memory.search` (typed `MemoryRetrievalPort` from `packages/memory-engine`), `knowledge.search` (typed `KnowledgeRetrievalPort` from `packages/knowledge-engine`), `system.health` (typed runtime + tool runtime + router + provider registry snapshot) and `discovery.analyze` (deterministic Gap Analysis + Question Generation over a supplied `CompanyDNA` and optional `FounderBrain`, delegating to `packages/business-discovery` — Sprint 29). It exposes `registerAllCoreTools(registry, context)` as the single composition point: hosts must call it exactly once. The catalog depends only on contracts already exposed by `packages/organization-domain`, `packages/memory-engine`, `packages/knowledge-engine`, `packages/llm-router` and `packages/business-discovery` (types only). It must not create new runtimes, bridges, packages, IA, embeddings, vector search, HTTP clients, Fastify, Supabase, Docker, plugins, MCP, or external SDKs.

`packages/business-discovery` is the only authorized boundary for discovering a company. Sprint 28 introduces the foundation for understanding a business before building its Empresa Digital. Models the complete pipeline without executing AI, scraping, or HTTP calls. Owns `BusinessDiscoveryRequest`, `BusinessDiscoverySession`, `CompanyDiscoveryReport`, `CompanyDNA` (canonical company identity model with mission, vision, values, products, services, market, positioning, strengths, weaknesses, objectives, processes), `FounderBrain` (canonical founder psychology model with leadership style, priorities, philosophy, risk tolerance, delegation, decision making, communication preferences), deterministic `GapAnalysis` (detects missing information without AI), and adaptive `QuestionGenerator` (produces targeted questions via deterministic rules). The pipeline flows: Input → Discovery Session → Company DNA → Founder Brain → Gap Analysis → Questions → Result. No AI, no LLM Router, no HTTP, no SDKs, no Fastify, no Supabase, no Docker.

`packages/memory-engine` is the provider-independent memory model boundary. It defines memory records, working/episodic/semantic/organization/agent memory kinds, context assembly, sessions, retention policies, retrieval contracts, lifecycle rules, internal events, and validation. It must not generate vectors, call models, access concrete storage, implement RAG, expose transport APIs, import provider SDKs, or read environment variables.

`packages/knowledge-engine` is the provider-independent knowledge model boundary. It defines knowledge documents, chunks, sources, collections, scopes, abstract indexing plans, retrieval contracts, ranking policies, lifecycle rules, internal events, and validation. RAG is a future capability of this package, not the engine itself. It must not generate embeddings, use vector storage, implement concrete search, expose transport APIs, import provider SDKs, or read environment variables.

## Important paths

| Path                             | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| apps/backend/                    | Independent Fastify backend runtime                  |
| apps/portal/                     | Independent Vite portal runtime                      |
| packages/agent-domain/           | Canonical provider-independent Agent domain          |
| packages/agent-runtime/          | Provider-independent digital employee runtime        |
| packages/application/            | Pure application orchestration layer                 |
| packages/config/                 | Only authorized runtime configuration reader         |
| packages/executive-director/     | Provider-independent system orchestration boundary   |
| packages/executive-orchestrator/ | Wires Executive Director into the runtime flow       |
| packages/knowledge-engine/       | Provider-independent knowledge model boundary        |
| packages/llm-provider-google/    | Google Vertex AI adapter for LLM Router contracts    |
| packages/llm-provider-minimax/   | MiniMax (OpenAI-compatible) adapter for LLM Router   |
| packages/llm-provider-openai/    | OpenAI adapter for LLM Router contracts              |
| packages/llm-provider-bridge/    | Multi-provider composition boundary for LLM Router   |
| packages/llm-router/             | Only authorized AI model routing boundary            |
| packages/memory-engine/          | Provider-independent memory model boundary           |
| packages/organization-domain/    | Canonical provider-independent Organization domain   |
| packages/platform-composition/   | Official package composition and first provisioning  |
| packages/persistence-contracts/  | Provider-independent persistence contracts           |
| packages/persistence-supabase/   | Supabase implementation of persistence contracts     |
| packages/agent-tool-bridge/      | Official Agent Runtime ↔ Tool Runtime bridge         |
| packages/tool-catalog/          | Official catalog of core Tools (incl. discovery.analyze) |
| packages/workflows/              | Department collaboration layer (workflows)           |
| packages/business-events/        | Event-driven composition layer                       |
| packages/business-discovery/     | Only authorized boundary for discovering a company     |
| packages/provisioning-engine/    | Organization provisioning contracts and state model  |
| packages/departments/            | External product unit composed of existing contracts |
| packages/tool-runtime/           | Only authorized boundary for executing Tools         |
| deploy/docker/                   | Docker image definitions                             |
| supabase/                        | Supabase CLI local configuration                     |
| docs/                            | Repository documentation                             |
| docs/adr/                        | Architecture decisions                               |
| railway.json                     | Railway Docker deployment config                     |
| compose.yaml                     | Local Docker composition                             |
| .env.example                     | Golden Image variable contract                       |

## Commands

```sh
pnpm install
pnpm check
pnpm format
pnpm exec supabase start
pnpm --filter @departify/persistence-supabase test:integration
pnpm --filter @departify/platform-composition test:e2e
pnpm --filter @departify/llm-provider-openai test:integration
pnpm exec netlify dev --filter @departify/portal
pnpm exec railway link
docker compose up --build
```
