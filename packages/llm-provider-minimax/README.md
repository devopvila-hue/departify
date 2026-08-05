# MiniMax LLM Provider

Official MiniMax adapter for the Departify LLM Router.

MiniMax exposes an OpenAI-compatible HTTP API. This adapter reuses the OpenAI SDK with a custom `baseURL` and authenticates through `MINIMAX_API_KEY`. It is fully isolated inside this package — no SDK types leak to the rest of the system.

Sprint 19 exposes `registerMiniMaxProvider(registry)` so the LLM Router composition can register the provider through the Provider Registry without any provider-specific knowledge.
