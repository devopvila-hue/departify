# Supabase Persistence Adapter

`@departify/persistence-supabase` is the first concrete persistence adapter for Departify.

It implements the repository and unit-of-work contracts from `@departify/persistence-contracts` using the official Supabase JavaScript client. Configuration is supplied through `@departify/config` types and never read directly from environment variables.

## Transaction Strategy

The current adapter uses Supabase Data API requests through `supabase-js`. Generic multi-request transactions are not available through this path without adding provider-specific RPC functions. The `UnitOfWork` implementation therefore provides a shared transaction context and repository set for orchestration, but it does not guarantee database-level atomicity across multiple repository calls.

Future sprints may add a provider-specific transaction primitive behind the same contract without changing domain, application, or persistence contracts.
