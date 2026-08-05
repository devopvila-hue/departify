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
- `packages/provisioning-engine`: only authorized boundary for future organization creation.

## Platform Boundaries

- Backend and portal are independent.
- Docker is the standard runtime for backend execution.
- Railway runs the backend Docker image and uses `/health` as the deployment healthcheck.
- Netlify is the official portal environment.
- Supabase is the official data platform, initialized by CLI configuration only in the Golden Image.
- The Golden Image installs platform infrastructure only.
- The Provisioning Engine owns future organization provisioning contracts, pipeline phases, and provisioning state.
- Agent Runtime is not part of the Golden Image.
- LLM routing is decoupled from applications.
- Memory, vector data, plugins, and workflows are organization-scoped concerns.
- OpenClaw is not part of the product.
