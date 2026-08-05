# OpenAI LLM Provider

Official OpenAI adapter for the Departify LLM Router.

This package is the only package allowed to import the OpenAI SDK. It consumes configuration from `@departify/config` and implements provider contracts from `@departify/llm-router` without exposing SDK-specific types.
