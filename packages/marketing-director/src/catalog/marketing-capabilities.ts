import { createMarketingCapability, type MarketingCapability } from "../models/marketing-capability.js";
import { type MarketingSpecialist } from "../models/marketing-specialist.js";
import { createSolutionCatalog, type SolutionCatalog } from "../models/solution-catalog.js";

export const MARKETING_CAPABILITIES: readonly MarketingCapability[] = [
  createMarketingCapability({
    id: "market_research",
    name: "market_research",
    description: "Analizar el mercado, la competencia y las oportunidades",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "audience_segmentation",
    name: "audience_segmentation",
    description: "Definir y segmentar la audiencia objetivo",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "positioning_strategy",
    name: "positioning_strategy",
    description: "Definir posicionamiento y propuesta de valor",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "content_creation",
    name: "content_creation",
    description: "Crear contenido escrito, visual y multimedia",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "content_strategy",
    name: "content_strategy",
    description: "Planificar calendarios y estrategias de contenido",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "campaign_strategy",
    name: "campaign_strategy",
    description: "Diseñar campañas y estrategias de adquisición",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "social_media",
    name: "social_media",
    description: "Gestionar presencia en redes sociales",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "seo_optimization",
    name: "seo_optimization",
    description: "Optimizar contenido para buscadores",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "analytics_measurement",
    name: "analytics_measurement",
    description: "Medir, analizar y reportar resultados",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "growth_experimentation",
    name: "growth_experimentation",
    description: "Diseñar y ejecutar experimentos de crecimiento",
    kind: "internal",
  }),
  createMarketingCapability({
    id: "email_marketing",
    name: "email_marketing",
    description: "Crear y enviar campañas de email",
    kind: "external",
    toolCapability: "email.send",
  }),
  createMarketingCapability({
    id: "lead_management",
    name: "lead_management",
    description: "Gestionar y hacer seguimiento de leads",
    kind: "external",
    toolCapability: "crm.contacts",
  }),
  createMarketingCapability({
    id: "document_collaboration",
    name: "document_collaboration",
    description: "Colaborar en documentos compartidos",
    kind: "external",
    toolCapability: "workspace.documents",
  }),
  createMarketingCapability({
    id: "advertising_paid",
    name: "advertising_paid",
    description: "Crear y gestionar campañas de pago",
    kind: "external",
    toolCapability: "ads.manage",
  }),
  createMarketingCapability({
    id: "web_analytics",
    name: "web_analytics",
    description: "Analizar tráfico y comportamiento web",
    kind: "external",
    toolCapability: "analytics.web",
  }),
];

export function buildCapabilityMap(): ReadonlyMap<string, MarketingCapability> {
  const map = new Map<string, MarketingCapability>();
  for (const cap of MARKETING_CAPABILITIES) {
    map.set(cap.id, cap);
  }
  return map;
}

export const MARKETING_SPECIALISTS: readonly MarketingSpecialist[] = [
  {
    id: "spec_acquisition",
    name: "Especialista en Adquisición",
    role: "Adquisición de clientes",
    summary: "Atrae nuevos clientes a través de canales orgánicos y de pago",
    skills: [
      {
        id: "skill_acquisition_channels",
        name: "Canales de Adquisición",
        capabilities: ["market_research", "audience_segmentation", "campaign_strategy"],
      },
      {
        id: "skill_paid_ads",
        name: "Publicidad Digital",
        capabilities: ["advertising_paid"],
      },
    ],
    capabilities: [
      "market_research",
      "audience_segmentation",
      "campaign_strategy",
      "advertising_paid",
    ],
  },
  {
    id: "spec_content",
    name: "Especialista en Contenido",
    role: "Creación de contenido",
    summary: "Crea contenido que conecta con la audiencia y genera confianza",
    skills: [
      {
        id: "skill_writing",
        name: "Redacción y Copywriting",
        capabilities: ["content_creation", "positioning_strategy"],
      },
      {
        id: "skill_content_planning",
        name: "Planificación de Contenido",
        capabilities: ["content_strategy", "seo_optimization"],
      },
      {
        id: "skill_social",
        name: "Redes Sociales",
        capabilities: ["social_media"],
      },
    ],
    capabilities: [
      "content_creation",
      "content_strategy",
      "positioning_strategy",
      "seo_optimization",
      "social_media",
    ],
  },
  {
    id: "spec_growth",
    name: "Especialista en Crecimiento",
    role: "Crecimiento y analítica",
    summary: "Mide, analiza y optimiza el crecimiento de forma sistemática",
    skills: [
      {
        id: "skill_analytics",
        name: "Analítica de Marketing",
        capabilities: ["analytics_measurement", "web_analytics"],
      },
      {
        id: "skill_growth_exp",
        name: "Experimentación",
        capabilities: ["growth_experimentation"],
      },
    ],
    capabilities: [
      "analytics_measurement",
      "growth_experimentation",
      "web_analytics",
    ],
  },
  {
    id: "spec_conversion",
    name: "Especialista en Conversión",
    role: "Optimización de conversión",
    summary: "Convierte visitantes en leads y leads en clientes",
    skills: [
      {
        id: "skill_cro",
        name: "CRO y Optimización",
        capabilities: ["audience_segmentation", "positioning_strategy"],
      },
      {
        id: "skill_nurture",
        name: "Nutrición de Leads",
        capabilities: ["email_marketing", "lead_management"],
      },
    ],
    capabilities: [
      "audience_segmentation",
      "positioning_strategy",
      "email_marketing",
      "lead_management",
    ],
  },
  {
    id: "spec_seo",
    name: "Especialista en SEO",
    role: "Posicionamiento en buscadores",
    summary: "Aumenta la visibilidad orgánica en buscadores",
    skills: [
      {
        id: "skill_onpage_seo",
        name: "SEO On-Page",
        capabilities: ["seo_optimization", "content_strategy"],
      },
      {
        id: "skill_technical_seo",
        name: "SEO Técnico",
        capabilities: ["web_analytics"],
      },
    ],
    capabilities: [
      "seo_optimization",
      "content_strategy",
      "web_analytics",
    ],
  },
];

export function buildSpecialistMap(): ReadonlyMap<string, MarketingSpecialist> {
  const map = new Map<string, MarketingSpecialist>();
  for (const spec of MARKETING_SPECIALISTS) {
    map.set(spec.id, spec);
  }
  return map;
}

export const SOLUTION_CATALOGS: readonly SolutionCatalog[] = [
  createSolutionCatalog("crm.contacts", [
    {
      toolId: "hubspot",
      name: "HubSpot",
      label: "HubSpot CRM",
      tier: "freemium",
      connectable: false,
      fitFor: ["startup", "pyme", "empresa"],
    },
    {
      toolId: "pipedrive",
      name: "Pipedrive",
      label: "Pipedrive",
      tier: "commercial",
      connectable: false,
      fitFor: ["pyme", "empresa"],
    },
    {
      toolId: "zoho",
      name: "Zoho CRM",
      label: "Zoho CRM",
      tier: "freemium",
      connectable: false,
      fitFor: ["autonomo", "startup", "pyme"],
    },
    {
      toolId: "twenty",
      name: "Twenty",
      label: "Twenty (open-source)",
      tier: "open_source",
      connectable: false,
      fitFor: ["autonomo", "startup"],
    },
  ]),
  createSolutionCatalog("email.send", [
    {
      toolId: "gmail",
      name: "Gmail",
      label: "Gmail",
      tier: "free",
      connectable: true,
      fitFor: ["autonomo", "startup", "pyme"],
    },
    {
      toolId: "outlook",
      name: "Outlook",
      label: "Outlook / Microsoft 365",
      tier: "commercial",
      connectable: true,
      fitFor: ["pyme", "empresa"],
    },
  ]),
  createSolutionCatalog("workspace.documents", [
    {
      toolId: "google_workspace",
      name: "Google Workspace",
      label: "Google Workspace",
      tier: "commercial",
      connectable: true,
      fitFor: ["startup", "pyme", "empresa"],
    },
    {
      toolId: "microsoft_365",
      name: "Microsoft 365",
      label: "Microsoft 365",
      tier: "commercial",
      connectable: true,
      fitFor: ["pyme", "empresa"],
    },
  ]),
  createSolutionCatalog("ads.manage", [
    {
      toolId: "google_ads",
      name: "Google Ads",
      label: "Google Ads",
      tier: "commercial",
      connectable: false,
      fitFor: ["startup", "pyme", "empresa"],
    },
    {
      toolId: "meta_ads",
      name: "Meta Ads",
      label: "Meta Ads (Facebook/Instagram)",
      tier: "commercial",
      connectable: false,
      fitFor: ["startup", "pyme", "empresa"],
    },
  ]),
  createSolutionCatalog("analytics.web", [
    {
      toolId: "google_analytics",
      name: "Google Analytics",
      label: "Google Analytics",
      tier: "free",
      connectable: false,
      fitFor: ["autonomo", "startup", "pyme", "empresa"],
    },
  ]),
];

export function getExistingToolCapabilities(
  connectedTools: readonly string[],
): ReadonlySet<string> {
  const caps = new Set<string>();
  for (const catalog of SOLUTION_CATALOGS) {
    for (const solution of catalog.solutions) {
      if (connectedTools.includes(solution.toolId)) {
        caps.add(catalog.capability);
      }
    }
  }
  return caps;
}
