# Architecture

Departify V2 follows a modular monorepo layout with independent application boundaries and package-level capability boundaries.

## Applications

- `apps/portal`: independent portal application.
- `apps/backend`: independent backend application.

## Packages

- `packages/auth`: authentication and authorization boundary.
- `packages/config`: shared configuration boundary.
- `packages/shared`: cross-cutting shared primitives boundary.
- `packages/logging`: logging and observability boundary.
- `packages/departments`: department capability boundary.
- `packages/llm-router`: decoupled LLM routing boundary.
- `packages/rag`: retrieval-augmented generation boundary.
- `packages/memory`: organization-scoped memory boundary.
- `packages/plugins`: organization-scoped plugin boundary.

## Platform Boundaries

- Backend and portal are independent.
- LLM routing is decoupled from applications.
- Memory, vector data, plugins, and workflows are organization-scoped concerns.
- OpenClaw is not part of the product.
