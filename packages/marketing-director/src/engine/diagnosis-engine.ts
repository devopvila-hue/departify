import {
  type CompanyDiscoveryReport,
} from "@departify/business-discovery";
import {
  type MarketingDiagnosis,
  type MarketingDiagnosisInput,
  type MarketingFinding,
  type MarketingOpportunity,
  type MarketingCapabilityGap,
} from "../models/marketing-diagnosis.js";
import { MARKETING_CAPABILITIES } from "../catalog/marketing-capabilities.js";

const GOAL_CATEGORIES: Record<string, {
  label: string;
  capabilities: string[];
  specialistRoles: string[];
}> = {
  conseguir_clientes: {
    label: "Conseguir clientes",
    capabilities: [
      "market_research",
      "audience_segmentation",
      "positioning_strategy",
      "content_creation",
      "content_strategy",
      "campaign_strategy",
      "social_media",
      "analytics_measurement",
      "email_marketing",
      "lead_management",
    ],
    specialistRoles: ["spec_acquisition", "spec_content", "spec_growth"],
  },
  vender_mas: {
    label: "Vender más",
    capabilities: [
      "audience_segmentation",
      "positioning_strategy",
      "campaign_strategy",
      "analytics_measurement",
      "email_marketing",
      "lead_management",
    ],
    specialistRoles: ["spec_conversion", "spec_content", "spec_growth"],
  },
  dar_a_conocer: {
    label: "Dar a conocer",
    capabilities: [
      "content_creation",
      "content_strategy",
      "social_media",
      "seo_optimization",
      "analytics_measurement",
    ],
    specialistRoles: ["spec_content", "spec_seo", "spec_growth"],
  },
  lanzar_negocio: {
    label: "Lanzar negocio",
    capabilities: [
      "market_research",
      "audience_segmentation",
      "positioning_strategy",
      "content_creation",
      "content_strategy",
      "campaign_strategy",
      "social_media",
      "analytics_measurement",
      "email_marketing",
      "lead_management",
    ],
    specialistRoles: [
      "spec_acquisition",
      "spec_content",
      "spec_growth",
      "spec_conversion",
    ],
  },
  ahorrar_tiempo: {
    label: "Ahorrar tiempo",
    capabilities: [
      "content_strategy",
      "social_media",
      "email_marketing",
      "analytics_measurement",
    ],
    specialistRoles: ["spec_content", "spec_growth"],
  },
  otro: {
    label: "Otro objetivo",
    capabilities: [
      "market_research",
      "campaign_strategy",
      "analytics_measurement",
    ],
    specialistRoles: ["spec_acquisition", "spec_growth"],
  },
};

export function produceMarketingDiagnosis(
  input: MarketingDiagnosisInput,
  report: CompanyDiscoveryReport | null,
): MarketingDiagnosis {
  const goalCategory = detectGoalCategory(input.goal);
  const goalConfig: { label: string; capabilities: string[]; specialistRoles: string[] } =
    (GOAL_CATEGORIES as Record<string, { label: string; capabilities: string[]; specialistRoles: string[] }>)[goalCategory] ??
    (GOAL_CATEGORIES as Record<string, { label: string; capabilities: string[]; specialistRoles: string[] }>).otro!;

  const findings = produceFindings(input, report);
  const opportunities = produceOpportunities(input, goalConfig);
  const capabilityGaps = produceCapabilityGaps(
    goalConfig.capabilities,
    input.connectedTools,
  );

  const whatCanBeDoneNow = produceWhatCanBeDoneNow(
    capabilityGaps,
    opportunities,
  );
  const whatIsBlocked = produceWhatIsBlocked(capabilityGaps);

  return {
    companyName: input.companyName,
    goal: input.goal,
    locale: input.locale,

    whatTheCeoWants: buildWhatCeoWants(input),
    whereTheyAreNow: buildWhereTheyAreNow(input, report),
    whatSeemsMissing: findings,
    opportunities,

    neededCapabilities: capabilityGaps,
    neededSpecialistRoles: goalConfig.specialistRoles,

    whatCanBeDoneNow,
    whatIsBlocked,
    whatToDoFirst: whatCanBeDoneNow[0] ?? opportunities[0]?.title ?? "",
    whatNotWorthDoingYet: produceWhatNotWorthDoingYet(input, goalConfig),

    generatedAt: new Date(),
  };
}

function detectGoalCategory(goal: string): string {
  const lower = goal.toLowerCase();
  if (lower.includes("cliente") || lower.includes("conseguir") || lower.includes("captar")) {
    return "conseguir_clientes";
  }
  if (lower.includes("vender") || lower.includes("facturar") || lower.includes("ingreso")) {
    return "vender_mas";
  }
  if (
    lower.includes("conocer") ||
    lower.includes("visibilidad") ||
    lower.includes("marca") ||
    lower.includes("brand")
  ) {
    return "dar_a_conocer";
  }
  if (
    lower.includes("lanzar") ||
    lower.includes("lanzamiento") ||
    lower.includes("empezar") ||
    lower.includes("crear negocio")
  ) {
    return "lanzar_negocio";
  }
  if (lower.includes("ahorrar") || lower.includes("automatizar") || lower.includes("tiempo")) {
    return "ahorrar_tiempo";
  }
  return "otro";
}

function produceFindings(
  input: MarketingDiagnosisInput,
  report: CompanyDiscoveryReport | null,
): readonly MarketingFinding[] {
  const findings: MarketingFinding[] = [];

  if (!input.hasWebsite && !input.description) {
    findings.push({
      category: "presencia_digital",
      observation: "No tiene presencia digital declarada",
      evidence: ["No tiene web ni descripción del negocio"],
      confidence: "high",
    });
  }

  if (input.country === "España" || input.country === "Spain") {
    findings.push({
      category: "mercado_local",
      observation: "Mercado objetivo: España. Oportunidad de marketing localizado en español.",
      evidence: ["País declarado: " + (input.country ?? "España")],
      confidence: "high",
    });
  }

  if (input.companySize === "solo yo" || input.companySize === "2-10") {
    findings.push({
      category: "equipo_reducido",
      observation: "Equipo reducido. Las tácticas deben ser de bajo esfuerzo y alto impacto.",
      evidence: ["Tamaño: " + (input.companySize ?? "pequeño")],
      confidence: "high",
    });
  }

  if (input.companySize === "solo yo") {
    findings.push({
      category: "fundador_unico",
      observation: "Fundador/a único/a. El marketing debe caber en la agenda del CEO.",
      evidence: ["Tamaño: solo yo"],
      confidence: "high",
    });
  }

  if (report) {
    const gaps = report.gaps.filter((g) => g.importance === "critical");
    if (gaps.length > 0) {
      findings.push({
        category: "informacion_pendiente",
        observation: `Falta información clave: ${gaps.map((g) => g.category).join(", ")}`,
        evidence: gaps.map((g) => `Gap en ${g.category}: ${g.description}`),
        confidence: "high",
      });
    }
  }

  if (input.declaredTools.length === 0 && input.connectedTools.length === 0) {
    findings.push({
      category: "sin_herramientas",
      observation: "No se ha declarado ninguna herramienta de trabajo.",
      evidence: ["No hay herramientas conectadas ni declaradas"],
      confidence: "high",
    });
  }

  return findings;
}

function produceOpportunities(
  input: MarketingDiagnosisInput,
  goalConfig: (typeof GOAL_CATEGORIES)[string],
): readonly MarketingOpportunity[] {
  const opps: MarketingOpportunity[] = [];
  const isSolo = input.companySize === "solo yo";
  const isEs = input.country === "España" || input.country === "Spain";

  if (goalConfig.label === "Conseguir clientes") {
    opps.push({
      id: "opp_quick_wins",
      title: "Identificar canales de captación más rápidos",
      description: isEs
        ? "Analizar dónde están los clientes potenciales en España y definir 2-3 canales prioritarios para empezar a captar."
        : "Analizar dónde están los clientes potenciales y definir 2-3 canales prioritarios para empezar a captar.",
      priority: 1,
      neededCapabilities: ["market_research", "audience_segmentation"],
    });
    opps.push({
      id: "opp_positioning",
      title: "Definir mensaje y propuesta de valor",
      description: "Crear un mensaje claro que explique qué haces, para quién y por qué eres diferente.",
      priority: 2,
      neededCapabilities: ["positioning_strategy", "content_creation"],
    });
    if (isSolo) {
      opps.push({
        id: "opp_content_fast",
        title: "Crear contenido de alto impacto con bajo esfuerzo",
        description:
          "Diseñar 3-5 piezas de contenido que puedas crear y distribuir sin depender de un equipo grande.",
        priority: 3,
        neededCapabilities: ["content_creation", "content_strategy"],
      });
    }
  }

  if (goalConfig.label === "Dar a conocer") {
    opps.push({
      id: "opp_content_engine",
      title: "Crear motor de contenido",
      description: "Definir temas, formatos y canales para empezar a generar visibilidad de forma consistente.",
      priority: 1,
      neededCapabilities: ["content_strategy", "content_creation"],
    });
    opps.push({
      id: "opp_seo_basics",
      title: "Sentar las bases de SEO",
      description: "Identificar palabras clave relevantes y optimizar la presencia básica en buscadores.",
      priority: 2,
      neededCapabilities: ["seo_optimization", "content_strategy"],
    });
    opps.push({
      id: "opp_social_presence",
      title: "Activar presencia en redes sociales",
      description: "Elegir 1-2 plataformas donde esté tu audiencia y crear un plan de publicación.",
      priority: 3,
      neededCapabilities: ["social_media", "content_creation"],
    });
  }

  if (goalConfig.label === "Vender más") {
    opps.push({
      id: "opp_audit_conversion",
      title: "Auditar el funnel de conversión actual",
      description: "Identificar dónde se pierden clientes potenciales y priorizar mejoras.",
      priority: 1,
      neededCapabilities: ["analytics_measurement", "audience_segmentation"],
    });
    opps.push({
      id: "opp_nurture_leads",
      title: "Crear secuencia de nutrición de leads",
      description: "Diseñar comunicaciones que acompañen a los leads hasta la decisión de compra.",
      priority: 2,
      neededCapabilities: ["email_marketing", "lead_management", "content_creation"],
    });
  }

  if (opps.length === 0) {
    opps.push({
      id: "opp_research_first",
      title: "Investigar antes de actuar",
      description:
        "Antes de ejecutar, necesito entender mejor el mercado y la audiencia para recomendar el camino correcto.",
      priority: 1,
      neededCapabilities: ["market_research", "audience_segmentation"],
    });
  }

  return opps;
}

function produceCapabilityGaps(
  neededCapabilityIds: readonly string[],
  connectedTools: readonly string[],
): readonly MarketingCapabilityGap[] {
  const capMap = new Map(MARKETING_CAPABILITIES.map((c) => [c.id, c]));
  const caps = new Set<string>();
  for (const catalog of [
    {
      cap: "crm.contacts",
      tools: ["hubspot", "pipedrive", "zoho", "twenty"],
    },
    { cap: "email.send", tools: ["gmail", "outlook"] },
    { cap: "workspace.documents", tools: ["google_workspace", "microsoft_365"] },
    { cap: "ads.manage", tools: ["google_ads", "meta_ads"] },
    { cap: "analytics.web", tools: ["google_analytics"] },
  ]) {
    for (const tool of catalog.tools) {
      if (connectedTools.includes(tool)) {
        caps.add(catalog.cap);
      }
    }
  }

  return neededCapabilityIds.map((id) => {
    const cap = capMap.get(id);
    if (!cap || cap.kind === "internal") {
      return {
        capability: id,
        name: cap?.name ?? id,
        reason: "",
        blocked: false,
      };
    }
    const hasTool = cap.toolCapability !== undefined && caps.has(cap.toolCapability);
    return {
      capability: id,
      name: cap.name,
      reason: cap.toolCapability !== undefined
        ? `Requiere ${cap.toolCapability} para ejecutar acciones externas`
        : "Requiere herramienta externa",
      blocked: !hasTool,
      ...(cap.toolCapability !== undefined ? { toolCapability: cap.toolCapability } : {}),
      ...(hasTool ? { existingTool: "una herramienta conectada" } : {}),
    };
  });
}

function produceWhatCanBeDoneNow(
  gaps: readonly MarketingCapabilityGap[],
  opportunities: readonly MarketingOpportunity[],
): readonly string[] {
  const internalGaps = gaps.filter((g) => !g.blocked);
  const items: string[] = [];

  for (const opp of opportunities) {
    const allAvailable = opp.neededCapabilities.every(
      (cap) => !gaps.find((g) => g.capability === cap)?.blocked,
    );
    if (allAvailable) {
      items.push(opp.title);
    }
  }

  if (items.length === 0) {
    const firstInternal = internalGaps[0];
    if (firstInternal) {
      items.push(`Analizar ${firstInternal.name}`);
    }
  }

  return items;
}

function produceWhatIsBlocked(
  gaps: readonly MarketingCapabilityGap[],
): readonly string[] {
  return gaps
    .filter((g) => g.blocked)
    .map(
      (g) => `No puedo ejecutar ${g.name} sin conectar ${g.toolCapability ?? "una herramienta externa"}`,
    );
}

function produceWhatNotWorthDoingYet(
  input: MarketingDiagnosisInput,
  goalConfig: (typeof GOAL_CATEGORIES)[string],
): readonly string[] {
  const items: string[] = [];
  const isSolo = input.companySize === "solo yo";

  if (isSolo) {
    items.push("Campañas de pago complejas: mejor validar primero con canales orgánicos.");
    items.push("Estrategia multicanal completa: mejor centrarse en 1-2 canales primero.");
  }

  if (goalConfig.label !== "Dar a conocer") {
    items.push(
      "Invertir en SEO técnico avanzado antes de tener contenido y presencia básica.",
    );
  }

  return items;
}

function buildWhatCeoWants(
  input: MarketingDiagnosisInput,
): string {
  const isEs = input.locale !== "en";
  const company = input.companyName;
  const goal = input.goal;
  const country = input.country;

  if (isEs) {
    let text = `${company} quiere ${goal.toLowerCase()}.`;
    if (country) {
      text += ` El foco está en ${country}.`;
    }
    return text;
  }
  let text = `${company} wants to ${goal.toLowerCase()}.`;
  if (country) {
    text += ` The focus is on ${country}.`;
  }
  return text;
}

function buildWhereTheyAreNow(
  input: MarketingDiagnosisInput,
  report: CompanyDiscoveryReport | null,
): string {
  const isEs = input.locale !== "en";
  const parts: string[] = [];

  if (input.hasWebsite) {
    parts.push(
      isEs ? "Tiene presencia web" : "Has web presence",
    );
  } else if (input.description) {
    parts.push(
      isEs
        ? "Está definiendo el negocio (sin web todavía)"
        : "Defining the business (no website yet)",
    );
  } else {
    parts.push(
      isEs
        ? "Está en fase muy inicial"
        : "Very early stage",
    );
  }

  if (input.companySize === "solo yo") {
    parts.push(
      isEs ? "Equipo: fundador/a único/a" : "Team: solo founder",
    );
  } else if (input.companySize) {
    parts.push(
      isEs
        ? `Equipo: ${input.companySize}`
        : `Team: ${input.companySize}`,
    );
  }

  const connectedCount = input.connectedTools.length;
  if (connectedCount > 0) {
    parts.push(
      isEs
        ? `${connectedCount} herramienta(s) conectada(s)`
        : `${connectedCount} connected tool(s)`,
    );
  }

  if (report) {
    const gapCount = report.gaps.length;
    if (gapCount > 0) {
      parts.push(
        isEs
          ? `${gapCount} áreas por explorar`
          : `${gapCount} areas to explore`,
      );
    }
  }

  return parts.join(". ") + ".";
}

export { detectGoalCategory };
