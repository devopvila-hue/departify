# OpenAI LLM Provider

Official OpenAI adapter for the Departify LLM Router.

This package is the only package allowed to import the OpenAI SDK. It consumes configuration from `@departify/config` and implements provider contracts from `@departify/llm-router` without exposing SDK-specific types.

Sprint 18 adds `registerOpenAIProvider(registry)`, the canonical bridge between this adapter and the LLM Router `ProviderRegistry`. Hosts should never import the OpenAI SDK directly outside this package; instead they bootstrap the LLM Router and let it dispatch through the registry.
