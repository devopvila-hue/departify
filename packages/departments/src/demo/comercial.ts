import {
  DepartmentService,
  createDepartmentService,
} from "../services/department-service.js";
import type { DepartmentSnapshot } from "../domain/department-types.js";

/**
 * Demo: Comercial department.
 *
 * The Comercial department ships three Digital Employees (LeadQualifier,
 * OutreachSpecialist, ProposalWriter) and pre-associates a handful of
 * Tools, Knowledge Collections and Memory Sessions. The fixture is purely
 * deterministic and exists for tests and documentation.
 */
export function buildComercialDepartment(): {
  service: DepartmentService;
  snapshot: DepartmentSnapshot;
} {
  const service = createDepartmentService();

  service.create({
    id: "dep_comercial",
    organizationId: "org_departify",
    name: "Comercial",
    description:
      "Customer-facing sales department responsible for qualification, outreach and proposal writing.",
    configuration: {
      displayName: "Comercial",
      description: "Sales department for Departify's commercial motion.",
      tags: ["sales", "customer-facing"],
      metadata: {
        locale: "es-ES",
        timezone: "Europe/Madrid",
      },
    },
    directorAgentId: "agent_sales_director",
    initialEmployeeAgentIds: [
      "agent_sales_director",
      "agent_lead_qualifier",
      "agent_outreach_specialist",
      "agent_proposal_writer",
    ],
    initialConnections: [
      { kind: "tool", referenceId: "system.health" },
      { kind: "tool", referenceId: "organization.get" },
      { kind: "tool", referenceId: "system.uuid" },
      { kind: "knowledge_collection", referenceId: "kcol_sales_playbook" },
      { kind: "knowledge_collection", referenceId: "kcol_pricing" },
      { kind: "memory_session", referenceId: "mem_session_comercial" },
      { kind: "connected_application", referenceId: "crm_hubspot" },
    ],
  });

  service.activate("dep_comercial");

  const snapshot = service.get("dep_comercial").toSnapshot();
  return { service, snapshot };
}
