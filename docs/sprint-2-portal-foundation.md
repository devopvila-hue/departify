# Sprint 2 Portal Foundation

## Scope

Sprint 2 initializes the Departify portal infrastructure inside `apps/portal`.

Included:

- Vite + React runtime.
- React Router boundary.
- React Query provider boundary.
- CSS token entrypoint.
- TypeScript configuration for browser code.
- ESLint configuration.
- Vitest + Testing Library smoke test.
- Legacy reference inventory and classification.

Excluded:

- Portal product pages.
- Authentication and login.
- Backend/API integration.
- Database integration.
- Router LLM, RAG, memory, plugins, and n8n workflows.
- Legacy page or directory migration.
- Business logic.

## Validation

Run:

```sh
pnpm check
pnpm format
```

The portal check includes linting, typechecking, tests, and a production build.
