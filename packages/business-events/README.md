# Business Events

Official event-driven composition layer for Departify.

The user generates **Business Events** (`lead.created`, `organization.created`, `organization.provisioned`). The `BusinessEventService` resolves each event through the `BusinessEventCatalog` and dispatches it to the existing runtimes:

```
BusinessEvent
       ↓
BusinessEventService.publish
       ↓
BusinessEventCatalog (rule-based mapping)
       ↓
   ┌───────────┼───────────┐
   ↓           ↓           ↓
WorkflowExecution  BusinessProvisioningService  ExecutiveOrchestrator
(workflows)         (provisioning)             (orchestration)
```

The package **never** executes business logic directly. Every event handler is a thin adapter that calls an existing runtime (`WorkflowExecution`, `BusinessProvisioningService`, `ExecutiveOrchestrator`). The package never modifies any of those runtimes.

Sprint 27 ships three events:

- `lead.created` → `wf_lead_qualification` (Lead Qualification Workflow).
- `organization.created` → existing business provisioning.
- `organization.provisioned` → initial company activation.
