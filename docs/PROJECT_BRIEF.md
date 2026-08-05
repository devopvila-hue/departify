# Project Brief

## Summary

Departify V2 is a new SaaS AI-first multi-company platform built on ROSA v1.0.2.

The repository is a portable monorepo with independent portal and backend applications, centralized configuration, and a Docker-first Golden Image foundation.

Sprint 5 adds the Provisioning Engine foundation as the sole architectural boundary for future organization creation. It defines contracts, pipeline phases, validation primitives, ports, and state transitions without creating organizations or executing product behavior.

Sprint 6 adds the canonical Organization domain model as the source of truth for representing an organization. It defines the aggregate root, value objects, domain events, lifecycle policy, and pure invariants without persistence, provider dependencies, agents, AI, or product features.

Sprint 7 adds the Application Layer foundation. It defines commands, queries, handlers, DTOs, mappers, application services, validation, and application ports that coordinate the Organization Domain and Provisioning Engine without infrastructure or business rules.

Sprint 8 adds the Persistence Contracts foundation. It defines repository interfaces, unit of work, transaction contracts, specifications, pagination, filters, optimistic locking, and provider-neutral errors without adapters, drivers, schemas, migrations, or storage implementations.

Sprint 12 adds the canonical Agent domain model as the source of truth for representing a Departify digital employee. It defines the aggregate root, value objects, domain events, lifecycle policy, and pure invariants without runtime coupling, persistence, provider dependencies, AI execution, or integrations.

Sprint 13 adds the Executive Director foundation as the system-level orchestration boundary. It defines intents, routing, planning, decisions, events, validation, and coordination contracts without executing infrastructure, persistence, model providers, agents, or product behavior.

## Goals

- Keep the product architecture new and independent from legacy systems.
- Run backend infrastructure through Docker in every environment.
- Use Railway for backend development operations, Netlify for the portal, and Supabase as the official data platform.
- Route all runtime configuration access through `packages/config`.
- Keep the Golden Image limited to platform execution primitives.
- Ensure all future organization creation goes through `packages/provisioning-engine`.
- Ensure all future persistence and application behavior adapts to `packages/organization-domain`, not the opposite.
- Keep use-case orchestration inside `packages/application` and keep infrastructure adapters outside this package.
- Keep all future storage implementations behind `packages/persistence-contracts`.
- Ensure all future agent behavior adapts to `packages/agent-domain`, not the opposite.
- Keep company-level orchestration decisions inside `packages/executive-director` while execution remains in downstream boundaries.

## Non-goals

- Do not implement business features in the Golden Image.
- Do not create agents, departments, memory, RAG, plugins, workflows, authentication, users, organizations, conversations, or functional APIs in foundation sprints.
- Do not depend on OpenClaw.
