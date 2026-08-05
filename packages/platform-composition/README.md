# Platform Composition

`@departify/platform-composition` is the official composition boundary for wiring Departify packages together.

Sprint 10 uses it to execute the first real organization provisioning flow:

Application Layer -> Provisioning Engine -> Organization Domain -> Persistence Contracts -> Supabase Adapter.

This package coordinates existing contracts. It does not redefine domain rules, persistence contracts, APIs, portal behavior, authentication, agents, RAG, memory, plugins, or workflows.
