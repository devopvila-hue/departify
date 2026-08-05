# LLM Provider Bridge

Multi-provider composition boundary for the Departify LLM Router.

This package wires the official `ProviderRegistry` with the three providers shipped in Sprint 19 (OpenAI, Google Vertex AI, MiniMax). It is the only package that knows how to assemble them — the router and individual providers stay fully decoupled.

The bridge is provider-agnostic: registration is delegated to each adapter through its own `registerXProvider(registry)` helper. Each adapter is responsible for loading its own configuration through `packages/config` and for reporting a descriptive failure when its credentials are missing.

## Usage

```ts
import { registerAllProviders } from "@departify/llm-provider-bridge";
import { ProviderRegistry } from "@departify/llm-router";

const registry = new ProviderRegistry();
registerAllProviders(registry);
```
