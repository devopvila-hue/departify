# Google Vertex AI LLM Provider

Official Google Vertex AI (Gemini) adapter for the Departify LLM Router.

This package is the only package authorized to import `@google-cloud/vertexai`. It consumes configuration from `@departify/config` and implements provider contracts from `@departify/llm-router` without exposing SDK-specific types.

Sprint 19 exposes `registerGoogleVertexProvider(registry)` so the LLM Router composition can register the provider through the Provider Registry without importing any SDK outside this package.
