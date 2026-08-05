# Project Brief

## Summary

Departify V2 is a new SaaS AI-first multi-company platform built on ROSA v1.0.2.

The repository is a portable monorepo with independent portal and backend applications, centralized configuration, and a Docker-first Golden Image foundation.

Sprint 5 adds the Provisioning Engine foundation as the sole architectural boundary for future organization creation. It defines contracts, pipeline phases, validation primitives, ports, and state transitions without creating organizations or executing product behavior.

## Goals

- Keep the product architecture new and independent from legacy systems.
- Run backend infrastructure through Docker in every environment.
- Use Railway for backend development operations, Netlify for the portal, and Supabase as the official data platform.
- Route all runtime configuration access through `packages/config`.
- Keep the Golden Image limited to platform execution primitives.
- Ensure all future organization creation goes through `packages/provisioning-engine`.

## Non-goals

- Do not implement business features in the Golden Image.
- Do not create agents, departments, memory, RAG, plugins, workflows, authentication, users, organizations, conversations, or functional APIs in foundation sprints.
- Do not depend on OpenClaw.
