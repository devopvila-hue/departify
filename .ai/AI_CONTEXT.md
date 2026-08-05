# AI Context

## Repository identity

Name: departify
Type: monorepo
ROSA: 1.0.2
Official ROSA repository: https://github.com/devopvila-hue/rosa

## Purpose

Departify V2 is a new ROSA-governed SaaS AI-first platform. The current repository state is a Golden Image foundation: monorepo structure, portal runtime, backend runtime, centralized configuration, official provider CLI setup, and Docker-first execution.

The Golden Image installs the platform. It does not create organizations, agents, memory, RAG, plugins, workflows, or business APIs.

## Important paths

| Path             | Purpose                                      |
| ---------------- | -------------------------------------------- |
| apps/backend/    | Independent Fastify backend runtime          |
| apps/portal/     | Independent Vite portal runtime              |
| packages/config/ | Only authorized runtime configuration reader |
| deploy/docker/   | Docker image definitions                     |
| supabase/        | Supabase CLI local configuration             |
| docs/            | Repository documentation                     |
| docs/adr/        | Architecture decisions                       |
| railway.json     | Railway Docker deployment config             |
| compose.yaml     | Local Docker composition                     |
| .env.example     | Golden Image variable contract               |

## Commands

```sh
pnpm install
pnpm check
pnpm format
pnpm exec supabase start
pnpm exec netlify dev --filter @departify/portal
pnpm exec railway link
docker compose up --build
```
