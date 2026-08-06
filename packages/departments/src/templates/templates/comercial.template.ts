import { DepartmentTemplateBuilder } from "../department-template-builder.js";
import type { DepartmentTemplate } from "../department-template-types.js";

/**
 * Comercial department template — Sprint 25 canonical business template.
 *
 * Defines the director, four Digital Employees, and the canonical set of
 * Tools, Knowledge Collections, Memory Sessions and connected applications
 * the Comercial department ships with. The template is data: there is no
 * hardcoded Department outside the template catalog.
 */
export function buildComercialTemplate(): DepartmentTemplate {
  return DepartmentTemplateBuilder.create({
    id: "tpl_comercial",
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
  })
    .withDirector({
      agentId: "agent_sales_director",
      displayName: "Sales Director",
      role: "director",
    })
    .withEmployee({
      agentId: "agent_lead_qualifier",
      displayName: "Lead Qualifier",
      role: "qualifier",
    })
    .withEmployee({
      agentId: "agent_outreach_specialist",
      displayName: "Outreach Specialist",
      role: "outreach",
    })
    .withEmployee({
      agentId: "agent_proposal_writer",
      displayName: "Proposal Writer",
      role: "proposal-writer",
    })
    .withTool("system.health", "Platform health")
    .withTool("organization.get", "Organization summary")
    .withTool("system.uuid", "Identifier generator")
    .withKnowledgeCollection("kcol_sales_playbook", "Sales playbook")
    .withKnowledgeCollection("kcol_pricing", "Pricing matrix")
    .withMemorySession("mem_session_comercial", "Comercial session")
    .withConnectedApplication("crm_hubspot", "CRM")
    .build();
}

/**
 * Catalogue id of the Comercial template.
 */
export const COMERCIAL_TEMPLATE_ID = "tpl_comercial";
