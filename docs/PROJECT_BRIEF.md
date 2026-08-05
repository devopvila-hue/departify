# Project Brief

## Summary

Departify V2 is a new SaaS AI-first multi-company platform built on ROSA v1.0.2.

The repository is a portable monorepo with independent portal and backend applications, centralized configuration, and a Docker-first Golden Image foundation.

## Goals

- Keep the product architecture new and independent from legacy systems.
- Run backend infrastructure through Docker in every environment.
- Use Railway for backend development operations, Netlify for the portal, and Supabase as the official data platform.
- Route all runtime configuration access through `packages/config`.
- Keep the Golden Image limited to platform execution primitives.

## Non-goals

- Do not implement business features in the Golden Image.
- Do not include agents, provisioning, departments, memory, RAG, plugins, workflows, authentication, users, organizations, conversations, or functional APIs.
- Do not depend on OpenClaw.
