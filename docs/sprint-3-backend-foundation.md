# Sprint 3 Backend Foundation

## Scope

Sprint 3 initializes the Departify backend infrastructure inside `apps/backend`.

Included:

- Fastify runtime.
- Environment configuration loading.
- Structured logging.
- Centralized error handling.
- Request id propagation through `x-request-id`.
- Graceful shutdown for `SIGINT` and `SIGTERM`.
- Technical `GET /health` endpoint.
- Technical `GET /version` endpoint.
- OpenAPI and Swagger UI registration.
- TypeScript, ESLint, and Vitest setup for backend code.

Excluded:

- Authentication.
- Users.
- Organizations.
- Database or migrations.
- Supabase.
- Conversations.
- Departments.
- LLM router.
- Memory.
- RAG.
- Plugins.
- n8n.
- Queues.
- SSE.
- WebSockets.
- Business behavior.

## Endpoints

| Method | Path             | Purpose                    |
| ------ | ---------------- | -------------------------- |
| GET    | `/health`        | Backend liveness status.   |
| GET    | `/version`       | Backend version metadata.  |
| GET    | `/documentation` | Swagger UI for OpenAPI QA. |

## Validation

Run:

```sh
pnpm check
pnpm format
```

Runtime verification used a local backend process on `127.0.0.1:43210`:

```text
/health 200 sprint-3-check {"status":"ok"}
/version 200 sprint-3-check {"name":"@departify/backend","version":"0.0.0","environment":"development"}
```
