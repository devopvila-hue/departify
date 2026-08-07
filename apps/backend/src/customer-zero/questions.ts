/**
 * Mandatory discovery questions — Sprint hotfix.
 *
 * The discovery pipeline (business-discovery, frozen) generates questions in
 * English. The Customer Zero UI locale is Spanish (`lang="es"`). This module
 * is the presentation boundary: it curates the questions derived from the
 * REAL gaps and localizes them to the UI locale WITHOUT modifying the frozen
 * business-discovery package.
 *
 * Rules (goal):
 * 1. Only gaps that really matter are asked (critical + high importance).
 * 2. One question per category (no redundant variants).
 * 3. Only categories that can be persisted back into Company DNA are asked.
 * 4. CEO answers are persisted with `user_input` verified provenance.
 */
import type {
  CompanyDiscoveryReport,
  DiscoveryQuestion,
  FindingCategory,
} from "@departify/business-discovery";

/** DNA categories that map to persistable CompanyDNA sections. */
const DNA_CATEGORIES: readonly FindingCategory[] = [
  "mission",
  "vision",
  "values",
  "value_proposition",
  "products",
  "services",
  "market",
  "ideal_customer",
  "tone",
  "positioning",
  "strengths",
  "weaknesses",
  "objectives",
  "processes",
];

const MAX_MANDATORY_QUESTIONS = 8;

/**
 * Spanish question catalog keyed by category. One canonical question per
 * category — enough for the CEO to answer the real gap without redundancy.
 */
const SPANISH_QUESTION: Readonly<Record<FindingCategory, string>> = {
  mission: "¿Cuál es la misión de tu empresa?",
  vision: "¿Dónde quieres llevar tu empresa en los próximos años?",
  values: "¿Cuáles son los valores que guían a tu empresa?",
  value_proposition: "¿Qué valor único aporta tu empresa a sus clientes?",
  products: "¿Qué productos ofrece tu empresa?",
  services: "¿Qué servicios ofrece tu empresa?",
  market: "¿En qué mercado o industria opera tu empresa?",
  ideal_customer: "¿Quién es tu cliente ideal?",
  tone: "¿Cómo describirías la personalidad de tu marca?",
  positioning: "¿Cómo se posiciona tu empresa frente a la competencia?",
  strengths: "¿Cuáles son los puntos fuertes de tu empresa?",
  weaknesses: "¿Qué desafíos o debilidades afronta tu empresa?",
  objectives: "¿Cuáles son los objetivos principales de tu empresa?",
  processes: "¿Cuáles son los procesos clave de tu empresa?",
  leadership_style: "¿Cómo describirías tu estilo de liderazgo?",
  priorities: "¿Cuáles son tus prioridades actuales?",
  philosophy: "¿Cuáles son las ideas que guían tu negocio?",
  risk_tolerance: "¿Cómo afronta tu empresa el riesgo?",
  delegation_style: "¿Cómo sueles delegar el trabajo?",
  decision_making: "¿Cómo tomas las decisiones importantes?",
  communication: "¿Cómo prefieres recibir la información?",
  preferences: "¿Qué preferencias tienes a la hora de trabajar?",
};

/** Localized options for multiple-choice categories. */
const SPANISH_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  tone: [
    "Profesional / formal",
    "Cercano / casual",
    "Audaz / diferente",
    "Cálido / accesible",
    "Experto / autoritario",
  ],
  positioning: [
    "Premium / lujo",
    "Gama alta",
    "Gama media",
    "Calidad-precio / económico",
  ],
};

export interface MandatoryQuestion {
  readonly category: FindingCategory;
  readonly question: string;
  readonly type: DiscoveryQuestion["type"];
  readonly options?: readonly string[];
  readonly importance: DiscoveryQuestion["importance"];
  readonly priority: number;
}

/**
 * Curates the mandatory questions from a real discovery report:
 * - only DNA categories that persist back into Company DNA,
 * - only critical + high importance gaps,
 * - one question per category (highest priority),
 * - localized to the UI locale (Spanish),
 * - capped at a small, focused set.
 */
export function curateMandatoryQuestions(
  report: CompanyDiscoveryReport,
  max: number = MAX_MANDATORY_QUESTIONS,
): readonly MandatoryQuestion[] {
  const byCategory = new Map<FindingCategory, DiscoveryQuestion>();

  for (const question of report.questions) {
    if (!DNA_CATEGORIES.includes(question.category)) {
      continue;
    }
    if (question.importance !== "critical" && question.importance !== "high") {
      continue;
    }
    const existing = byCategory.get(question.category);
    if (!existing || question.priority > existing.priority) {
      byCategory.set(question.category, question);
    }
  }

  const ordered = [...byCategory.values()].sort(
    (a, b) => b.priority - a.priority,
  );

  return ordered.slice(0, max).map((question) => ({
    category: question.category,
    question:
      SPANISH_QUESTION[question.category] ?? question.question,
    type: question.type,
    ...(question.options || SPANISH_OPTIONS[question.category]
      ? { options: SPANISH_OPTIONS[question.category] ?? question.options }
      : {}),
    importance: question.importance,
    priority: question.priority,
  }));
}
