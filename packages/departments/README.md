# Departments

External product unit. A Department is the **visible unit of the product** — what the customer sees, configures and manages. Each Department contains one or more **Digital Employees** (the internal execution unit, modelled by `@departify/agent-runtime` and `@departify/agent-domain`).

## Boundaries

A Department composes references to existing components:

- **Director (responsible Agent)** — reference to an Agent in `AgentRegistry`.
- **Digital Employees** — collection of Agent references inside the same organization.
- **Tools** — collection of Tool references from `Core Tool Catalog`.
- **Knowledge** — collection of Knowledge Collection references from `Knowledge Engine`.
- **Memory** — collection of Memory Session references from `Memory Engine`.
- **Connected Applications** — placeholder, no business logic yet.

The Department never duplicates logic. It only references the existing aggregates and exposes the composition to the rest of the platform.

## DepartmentService

The single composition entry point for managing Departments. Hosts call `DepartmentService.create`, `addEmployee`, `removeEmployee`, `listEmployees`, `associateTool`, `associateMemory`, `associateKnowledge`. The service is pure: no I/O, no SDK, no HTTP, no LLM Router.

## Demo: Comercial department

`packages/departments/src/demo/comercial.ts` ships a deterministic fixture that builds a Comercial department with three Digital Employees (LeadQualifier, OutreachSpecialist, ProposalWriter) and associated tools, knowledge and memory. The fixture is read-only and exists purely for tests and documentation.
