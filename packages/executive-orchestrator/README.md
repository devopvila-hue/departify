# Executive Orchestrator

First official orchestrator layer that wires Executive Director into the existing runtime flow:

```
OrchestratorIntent → Executive Director → ExecutiveDecision
       → DecisionMapper → AgentToolAction
       → AgentToolBridge → Tool Runtime → Core Tool Catalog → OrchestrationResult
```

The orchestrator is the only place that names the tool catalog and the bridge together. Executive Director's contracts remain untouched: the orchestrator adapts OrchestratorIntent into an existing Executive Intent (currently `assign_task`) and forwards the resulting decision through the DecisionMapper.

No IA, no LLM Router, no HTTP, no SDKs. Decisions are deterministic rules inside Executive Director.
