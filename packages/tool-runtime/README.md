# Tool Runtime

Provider-agnostic, host-independent runtime for executing Departify Tools.

`packages/tool-runtime` is the only boundary in Departify that is allowed to execute Tools. Executive Director decides; Agent Runtime plans; **Tool Runtime executes**. No other package may invoke a Tool directly.

Sprint 20 delivers the foundation only:

- Domain model (`Tool`, `ToolDefinition`, `ToolExecutionRequest`, `ToolExecutionResult`, `ToolExecutionContext`, `ToolCapability`, `ToolMetadata`).
- `ToolRegistry` with explicit registration, lookup and validation.
- Six-phase execution pipeline: `validate → authorize → prepare → execute → observe → complete`.
- Permissions, scopes, isolation, timeout, cancellation and limits modelled but not enforced against real tools.
- Provider-agnostic observability surface (logger + metrics) and event taxonomy (`registered`, `requested`, `started`, `completed`, `failed`, `cancelled`).
- Zero external dependencies: no `process.env`, no SDKs, no HTTP, no Fastify, no Supabase, no provider coupling.
