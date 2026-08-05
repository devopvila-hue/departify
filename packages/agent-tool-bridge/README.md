# Agent ↔ Tool Runtime Bridge

Official composition boundary between `@departify/agent-runtime` and `@departify/tool-runtime`.

The bridge is the only place in Departify that knows both runtimes. It owns:

- The `AgentToolPort` interface — the single authorised contract Agent Runtime uses to invoke Tools.
- The `AgentToolRuntimeAdapter` — translates Agent actions into `ToolExecutionRequest` and back.
- The demonstration `system.time` Tool — proves the pipeline end-to-end without external services, IA, or HTTP.

The bridge never modifies either runtime. It composes them. Executive Director, LLM Router, Memory Engine, Knowledge Engine, plugins and MCP are out of scope.
