# Sprint 1 Bootstrap

## Scope

Sprint 1 prepares the repository for controlled development.

Included:

- Monorepo workspace configuration.
- Application and package boundaries.
- Base TypeScript configuration.
- Base repository hygiene files.
- Minimal documentation.

Excluded:

- Portal implementation.
- Backend implementation.
- Login or authentication behavior.
- Database integration.
- API implementation.
- LLM router implementation.
- RAG implementation.
- Memory implementation.
- Plugin implementation.
- n8n workflow implementation.
- React components.
- Legacy code migration.

## Validation

The expected validation command is:

```sh
pnpm check
```

Until package implementations exist, package checks are placeholders that verify workspace wiring without introducing product logic.
