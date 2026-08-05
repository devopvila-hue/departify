# Backend

Independent backend application boundary.

Sprint 3 initializes the backend runtime only:

- Fastify server.
- Environment configuration loading.
- Structured logging through Fastify.
- Centralized error responses.
- Request id propagation.
- Graceful shutdown.
- Technical `/health` and `/version` endpoints.
- OpenAPI and Swagger UI registration.
- TypeScript, ESLint, and Vitest validation.

It intentionally contains no authentication, users, organizations, database, migrations, Supabase, conversations, departments, LLM router, memory, RAG, plugins, n8n, queues, SSE, WebSockets, or business behavior.

## Commands

```sh
pnpm --filter @departify/backend dev
pnpm --filter @departify/backend build
pnpm --filter @departify/backend start
pnpm --filter @departify/backend check
```

## Endpoints

- `GET /health`
- `GET /version`
- `GET /documentation`
