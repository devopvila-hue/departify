import type { DepartmentWorkCapability } from "./department-work.js";

export type DepartmentCapabilityDepartment = "marketing" | "seo";

export type DepartmentCapabilityState =
  | "disponible"
  | "necesita_conexion"
  | "no_disponible";

export interface DepartmentCapabilityDefinition {
  readonly id: string;
  readonly departmentId: DepartmentCapabilityDepartment;
  readonly label: string;
  readonly description: string;
  readonly providerToolIds: readonly string[];
  readonly requiredWorkCapabilities?: readonly DepartmentWorkCapability[];
}

export interface DepartmentCapabilityView extends DepartmentCapabilityDefinition {
  readonly state: DepartmentCapabilityState;
}

export interface CapabilityConnectionState {
  readonly toolId: string;
  readonly state: string;
  readonly capabilities?: readonly string[];
}

/**
 * Canonical business capabilities exposed as the department's operating team.
 * Specialist employees remain a separate operational projection because work
 * assignments target those stable internal roles. This registry is the source
 * for department counts and capability lists shown to the CEO.
 */
export const DEPARTMENT_CAPABILITIES: readonly DepartmentCapabilityDefinition[] = [
  {
    id: "marketing.content",
    departmentId: "marketing",
    label: "Estrategia de contenidos",
    description: "Define temas, mensajes y planes de contenido.",
    providerToolIds: [],
  },
  {
    id: "marketing.social",
    departmentId: "marketing",
    label: "Redes sociales",
    description: "Prepara y organiza la presencia en redes sociales.",
    providerToolIds: ["meta_business", "tiktok"],
  },
  {
    id: "marketing.paid",
    departmentId: "marketing",
    label: "Publicidad y adquisición",
    description: "Analiza y prepara campañas de captación.",
    providerToolIds: ["google_ads", "meta_ads", "tiktok_ads"],
  },
  {
    id: "marketing.campaigns",
    departmentId: "marketing",
    label: "Campañas",
    description: "Convierte objetivos en acciones y campañas coordinadas.",
    providerToolIds: ["meta_business", "google_ads", "meta_ads", "tiktok_ads"],
  },
  {
    id: "marketing.analytics",
    departmentId: "marketing",
    label: "Analítica y medición",
    description: "Interpreta resultados reales para decidir el siguiente paso.",
    providerToolIds: ["google_analytics", "google_ads", "meta_ads", "tiktok_ads"],
  },
  {
    id: "marketing.web-content",
    departmentId: "marketing",
    label: "Contenido web",
    description: "Trabaja con publicaciones y contenido de la web conectada.",
    providerToolIds: ["wordpress", "shopify"],
  },
  {
    id: "marketing.crm",
    departmentId: "marketing",
    label: "Relación con clientes",
    description: "Consulta y organiza contactos y campañas del CRM.",
    providerToolIds: ["hubspot", "mautic"],
  },
  {
    id: "seo.audit",
    departmentId: "seo",
    label: "Auditoría técnica",
    description: "Revisa problemas SEO verificables de la web pública.",
    providerToolIds: [],
    requiredWorkCapabilities: ["seo.audit.website"],
  },
  {
    id: "seo.metadata",
    departmentId: "seo",
    label: "Metadatos y estructura",
    description: "Revisa títulos, descripciones, encabezados y datos estructurados.",
    providerToolIds: [],
    requiredWorkCapabilities: ["seo.audit.website"],
  },
  {
    id: "seo.indexability",
    departmentId: "seo",
    label: "Indexabilidad y rastreo",
    description: "Comprueba canonical, robots, sitemap y enlaces internos.",
    providerToolIds: [],
    requiredWorkCapabilities: ["seo.audit.website"],
  },
  {
    id: "seo.content",
    departmentId: "seo",
    label: "Contenido y accesibilidad",
    description: "Detecta oportunidades en contenido, headings e imágenes.",
    providerToolIds: [],
    requiredWorkCapabilities: ["seo.audit.website"],
  },
  {
    id: "seo.repository-read",
    departmentId: "seo",
    label: "Análisis del proyecto web",
    description: "Localiza en el proyecto los archivos responsables de los problemas.",
    providerToolIds: ["github_repository"],
    requiredWorkCapabilities: ["seo.repository.read"],
  },
  {
    id: "seo.search-console",
    departmentId: "seo",
    label: "Rendimiento orgánico",
    description: "Añade clics, impresiones, CTR y posición cuando se conecte la fuente.",
    providerToolIds: ["google_search_console"],
  },
  {
    id: "seo.analytics",
    departmentId: "seo",
    label: "Analítica orgánica",
    description: "Añade tráfico y comportamiento cuando Analytics esté conectado.",
    providerToolIds: ["google_analytics"],
  },
] as const;

export function departmentCapabilityDefinitions(
  departmentId: DepartmentCapabilityDepartment,
): readonly DepartmentCapabilityDefinition[] {
  return DEPARTMENT_CAPABILITIES.filter((entry) => entry.departmentId === departmentId);
}

export function projectDepartmentCapabilities(
  departmentId: DepartmentCapabilityDepartment,
  connections: readonly CapabilityConnectionState[],
): readonly DepartmentCapabilityView[] {
  return departmentCapabilityDefinitions(departmentId).map((definition) => {
    if (definition.providerToolIds.length === 0) {
      return { ...definition, state: "disponible" };
    }
    const matching = connections.filter((connection) =>
      definition.providerToolIds.includes(connection.toolId),
    );
    const connected = matching.some((connection) => connection.state === "connected");
    const supported = matching.some((connection) => connection.state !== "unavailable");
    return {
      ...definition,
      state: connected ? "disponible" : supported ? "necesita_conexion" : "no_disponible",
    };
  });
}
