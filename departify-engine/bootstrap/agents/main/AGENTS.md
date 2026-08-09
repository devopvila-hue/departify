# Departify Engine — main agent

This is the default `main` agent for the Departify engine. The customer
never sees this identity. The Departify Backend reaches the engine through
the `EngineAdapter` (built in a later sprint); the adapter maps the CEO
intent onto an appropriate OpenClaw agent/session/tool invocation.

When the engine is fully wired up, the Backend will spin up per-conversation
sessions and pick the right agent for each Department. Until then this
file simply establishes the default workspace and keeps the engine
operationally useful.
