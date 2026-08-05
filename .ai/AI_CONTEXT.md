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

`packages/executive-director` is the provider-independent orchestration boundary for the digital company. It evaluates intents, routes them conceptually, creates decisions, emits internal events, and models coordination contracts toward Application Layer, Provisioning Engine, and Agent Runtime. It must not execute AI, implement the LLM Router, persist data, call providers, expose transport APIs, run agents, or access environment variables.

## Important paths

| Path                            | Purpose                                             |
| ------------------------------- | --------------------------------------------------- |
| apps/backend/                   | Independent Fastify backend runtime                 |
| apps/portal/                    | Independent Vite portal runtime                     |
| packages/agent-domain/          | Canonical provider-independent Agent domain         |
| packages/agent-runtime/         | Provider-independent digital employee runtime       |
| packages/application/           | Pure application orchestration layer                |
| packages/config/                | Only authorized runtime configuration reader        |
| packages/executive-director/    | Provider-independent system orchestration boundary  |
| packages/organization-domain/   | Canonical provider-independent Organization domain  |
| packages/platform-composition/  | Official package composition and first provisioning |
| packages/persistence-contracts/ | Provider-independent persistence contracts          |
| packages/persistence-supabase/  | Supabase implementation of persistence contracts    |
| packages/provisioning-engine/   | Organization provisioning contracts and state model |
| deploy/docker/                  | Docker image definitions                            |
| supabase/                       | Supabase CLI local configuration                    |
| docs/                           | Repository documentation                            |
| docs/adr/                       | Architecture decisions                              |
| railway.json                    | Railway Docker deployment config                    |
| compose.yaml                    | Local Docker composition                            |
| .env.example                    | Golden Image variable contract                      |

## Commands

```sh
pnpm install
pnpm check
pnpm format
pnpm exec supabase start
pnpm --filter @departify/persistence-supabase test:integration
pnpm --filter @departify/platform-composition test:e2e
pnpm exec netlify dev --filter @departify/portal
pnpm exec railway link
docker compose up --build
```
