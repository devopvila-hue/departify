# Workflows

First Department collaboration layer for Departify.

Workflows are **pure composition** over existing components:

```
WorkflowDefinition
       ↓
WorkflowExecution
       ↓
AgentToolBridge.executeAction (per step)
       ↓
Tool Runtime → Core Tool Catalog
```

Each Workflow step delegates to a Digital Employee through `AgentToolBridge`. The previous step's output is threaded into the next step's metadata, giving the workflow a typed context-passing chain.

Sprint 26 ships the **Lead Qualification Workflow** (`wf_lead_qualification`) which the Comercial department uses to qualify a lead, prepare a contact and generate a proposal. Each step is performed by a different Digital Employee.

Workflows depend only on `AgentToolBridge` and `Tool Runtime`. No IA, no LLM Router, no HTTP, no SDKs. The runtime layer is unchanged.
