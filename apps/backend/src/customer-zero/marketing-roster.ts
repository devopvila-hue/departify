import { buildMarketingTemplate } from "@departify/departments";
import type { DigitalEmployee } from "./marketing-domain.js";

/**
 * Business-facing metadata for the provisioned Marketing specialists.
 *
 * The employee ids are deliberately not authored here: the Department
 * Template is the authoritative composition source. This map only translates
 * the template's platform-neutral role codes into the labels the CEO sees.
 * The three entries are the exact Customer Zero Marketing roster established
 * by the historical `tpl_marketing` template.
 */
const BUSINESS_PROFILES: Readonly<Record<string, {
  readonly label: string;
  readonly role: string;
  readonly capabilities: readonly string[];
}>> = {
  agent_content_strategist: {
    label: "Especialista en Contenido",
    role: "Creación de contenido",
    capabilities: ["content_creation", "content_strategy", "positioning_strategy"],
  },
  agent_social_media_manager: {
    label: "Especialista en Redes Sociales",
    role: "Redes sociales",
    capabilities: ["social_media", "content_creation"],
  },
  agent_ads_specialist: {
    label: "Especialista en Publicidad",
    role: "Publicidad y adquisición",
    capabilities: ["advertising_paid", "campaign_strategy"],
  },
};

const MARKETING_TEMPLATE = buildMarketingTemplate();

/** Canonical provisioned Marketing specialists, excluding Elvira. */
export const MARKETING_ROSTER: readonly Omit<DigitalEmployee, "status" | "currentWork">[] =
  MARKETING_TEMPLATE.employees
    .filter((employee) => !employee.isDirector)
    .map((employee) => {
      const profile = BUSINESS_PROFILES[employee.agentId];
      if (!profile) {
        throw new Error(
          `Marketing template employee '${employee.agentId}' has no business profile`,
        );
      }
      return {
        id: employee.agentId,
        label: profile.label,
        role: profile.role,
        capabilities: profile.capabilities,
      };
    });
