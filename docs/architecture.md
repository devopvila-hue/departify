# Architecture

Departify V2 follows a modular monorepo layout with independent application boundaries and package-level capability boundaries.

## Applications

- `apps/portal`: independent portal application.
- `apps/backend`: independent backend application.

### Backend Foundation

`apps/backend` owns the Fastify runtime boundary. Sprint 3 includes only technical infrastructure: configuration loading, logging, centralized error responses, request id propagation, graceful shutdown, health/version endpoints, OpenAPI registration, and tests.

The backend does not contain authentication, users, organizations, persistence, Supabase, business APIs, LLM routing, memory, RAG, plugins, n8n, queues, SSE, or WebSockets.

## Packages

- `packages/auth`: authentication and authorization boundary.
- `packages/config`: centralized typed configuration boundary. Application code must not read `process.env` directly.
- `packages/shared`: cross-cutting shared primitives boundary.
- `packages/logging`: logging and observability boundary.
- `packages/departments`: department capability boundary.
- `packages/llm-router`: decoupled LLM routing boundary.
- `packages/rag`: retrieval-augmented generation boundary.
- `packages/memory`: organization-scoped memory boundary.
- `packages/plugins`: organization-scoped plugin boundary.
- `packages/application`: application orchestration boundary for commands, queries, DTOs, mappers, handlers, application services, and application ports.
- `packages/organization-domain`: canonical, provider-independent Organization domain model.
- `packages/persistence-contracts`: provider-independent persistence contracts for repositories, unit of work, transactions, specifications, pagination, filters, concurrency, and errors.
- `packages/persistence-supabase`: first concrete persistence adapter, implemented with the official Supabase JavaScript client and configured only through `packages/config`.
- `packages/provisioning-engine`: only authorized boundary for future organization creation.

## Platform Boundaries

- Backend and portal are independent.
- Docker is the standard runtime for backend execution.
- Railway runs the backend Docker image and uses `/health` as the deployment healthcheck.
- Netlify is the official portal environment.
- Supabase is the official data platform, initialized by CLI configuration only in the Golden Image.
- The Golden Image installs platform infrastructure only.
- The Provisioning Engine owns future organization provisioning contracts, pipeline phases, and provisioning state.
- The Organization domain owns the canonical aggregate, value objects, lifecycle states, domain events, and pure invariants for representing an organization.
- The Application Layer coordinates application use-case contracts between the Provisioning Engine and Organization domain. It must not own domain rules, persistence, provider SDKs, transport code, or infrastructure adapters.
- Persistence contracts define the stable interface that future storage implementations must satisfy. They do not contain adapters, schemas, migrations, drivers, or provider-specific behavior.
- The Supabase persistence adapter implements the persistence contracts without leaking Supabase row models to domain or application code. Its UnitOfWork provides a shared context; generic database-level atomicity across multiple Data API requests is not guaranteed without a future provider-specific transaction primitive.
- Future persistence must adapt to `packages/organization-domain`; the domain must not depend on databases, provider SDKs, Docker, Railway, Netlify, Supabase, OpenClaw, or environment variables.
- Agent Runtime is not part of the Golden Image.
- LLM routing is decoupled from applications.
- Memory, vector data, plugins, and workflows are organization-scoped concerns.
- OpenClaw is not part of the product.
