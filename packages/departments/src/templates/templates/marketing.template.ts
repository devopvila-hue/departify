import { DepartmentTemplateBuilder } from "../department-template-builder.js";
import type { DepartmentTemplate } from "../department-template-types.js";

/**
 * Marketing department template — Sprint 51, the Customer Zero department.
 *
 * The first real Digital Department: defines the director, three Digital
 * Employees, and the canonical set of Tools, Knowledge Collections, Memory
 * Sessions and connected applications the Marketing department ships with.
 * The template is data: there is no hardcoded Department outside the
 * template catalog.
 */
export function buildMarketingTemplate(): DepartmentTemplate {
  return DepartmentTemplateBuilder.create({
    id: "tpl_marketing",
    name: "Marketing",
    description:
      "Marketing department responsible for content, social media and paid acquisition.",
    configuration: {
      displayName: "Marketing",
      description: "Marketing department for Departify's growth motion.",
      tags: ["marketing", "growth"],
      metadata: {
        locale: "es-ES",
        timezone: "Europe/Madrid",
      },
    },
  })
    .withDirector({
      agentId: "agent_marketing_director",
      displayName: "Marketing Director",
      role: "director",
    })
    .withEmployee({
      agentId: "agent_content_strategist",
      displayName: "Content Strategist",
      role: "content",
    })
    .withEmployee({
      agentId: "agent_social_media_manager",
      displayName: "Social Media Manager",
      role: "social",
    })
    .withEmployee({
      agentId: "agent_ads_specialist",
      displayName: "Ads Specialist",
      role: "ads",
    })
    .withTool("system.health", "Platform health")
    .withTool("organization.get", "Organization summary")
    .withTool("system.uuid", "Identifier generator")
    .withKnowledgeCollection("kcol_marketing_playbook", "Marketing playbook")
    .withKnowledgeCollection("kcol_brand", "Brand guidelines")
    .withMemorySession("mem_session_marketing", "Marketing session")
    .withConnectedApplication("crm_hubspot", "CRM")
    .build();
}

/**
 * Catalogue id of the Marketing template.
 */
export const MARKETING_TEMPLATE_ID = "tpl_marketing";
