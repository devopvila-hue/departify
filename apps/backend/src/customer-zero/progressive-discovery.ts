/**
 * Progressive discovery — one contextual question at a time.
 *
 * Replaces the 14-question form. After every answer the Company DNA is
 * updated, the gaps are recomputed by the REAL discovery pipeline, and the
 * next highest-value question is selected from what is actually still
 * missing. A single answer can therefore close several gaps at once and the
 * redundant questions simply never get asked.
 *
 * Rule: QUESTION VALUE > QUESTION COMPLETENESS. Only `blocking` questions can
 * hold Marketing back; `useful` ones are asked while there is room, and
 * `optional` ones are never pushed to the CEO.
 */
import type {
  CompanyDiscoveryReport,
  FindingCategory,
} from "@departify/business-discovery";
import { TOOL_CATALOG } from "./connections.js";
import { t, type SupportedLocale } from "./locale.js";

export type QuestionWeight = "blocking" | "useful" | "optional";

export type QuestionComponent = "text" | "choice" | "multi_choice";

export interface ProgressiveQuestion {
  /** Stable id used by the client to answer. */
  readonly id: string;
  readonly kind: "dna" | "tools" | "crm" | "tool_detail";
  readonly category?: FindingCategory;
  readonly question: string;
  readonly component: QuestionComponent;
  readonly options?: readonly string[];
  readonly weight: QuestionWeight;
  /** Optional short context shown under the question. */
  readonly hint?: string;
}

/** DNA categories that persist back into Company DNA. */
const DNA_CATEGORIES: readonly FindingCategory[] = [
  "ideal_customer",
  "value_proposition",
  "products",
  "services",
  "market",
  "positioning",
  "tone",
  "objectives",
  "mission",
  "vision",
  "values",
  "strengths",
  "weaknesses",
  "processes",
];

/**
 * Business priority (Fase 6): what Marketing needs to work NOW comes first.
 * Lower rank = asked earlier.
 */
const CATEGORY_RANK: Readonly<Partial<Record<FindingCategory, number>>> = {
  objectives: 1,
  ideal_customer: 2,
  value_proposition: 3,
  products: 4,
  services: 5,
  positioning: 6,
  market: 7,
  tone: 8,
  mission: 9,
  vision: 10,
  values: 11,
  strengths: 12,
  weaknesses: 13,
  processes: 14,
};

/** Only these really block Marketing from starting. */
const BLOCKING_CATEGORIES: readonly FindingCategory[] = [
  "ideal_customer",
  "value_proposition",
];

const QUESTION_TEXT: Readonly<
  Partial<Record<FindingCategory, { es: string; en: string }>>
> = {
  mission: {
    es: "¿Cuál es la misión de tu empresa?",
    en: "What is your company's mission?",
  },
  vision: {
    es: "¿Dónde quieres llevar tu empresa en los próximos años?",
    en: "Where do you want to take your company in the coming years?",
  },
  values: {
    es: "¿Qué valores guían a tu empresa?",
    en: "Which values guide your company?",
  },
  value_proposition: {
    es: "¿Por qué te eligen a ti y no a otro?",
    en: "Why do customers choose you over someone else?",
  },
  products: {
    es: "¿Qué vendes exactamente?",
    en: "What exactly do you sell?",
  },
  services: {
    es: "¿Qué servicios ofreces?",
    en: "Which services do you offer?",
  },
  market: {
    es: "¿En qué mercado compites?",
    en: "Which market do you compete in?",
  },
  ideal_customer: {
    es: "¿Quién es tu cliente ideal?",
    en: "Who is your ideal customer?",
  },
  tone: {
    es: "¿Cómo quieres que suene tu marca?",
    en: "How do you want your brand to sound?",
  },
  positioning: {
    es: "¿Cómo te posicionas frente a la competencia?",
    en: "How do you position yourself against competitors?",
  },
  objectives: {
    es: "¿Qué quieres conseguir en los próximos tres meses?",
    en: "What do you want to achieve in the next three months?",
  },
  strengths: {
    es: "¿Qué haces mejor que nadie?",
    en: "What do you do better than anyone?",
  },
  weaknesses: {
    es: "¿Qué te está costando más ahora mismo?",
    en: "What is hardest for you right now?",
  },
  processes: {
    es: "¿Cómo trabajáis normalmente?",
    en: "How do you usually work?",
  },
};

const CHOICE_OPTIONS: Readonly<
  Partial<Record<FindingCategory, { es: readonly string[]; en: readonly string[] }>>
> = {
  tone: {
    es: [
      "Profesional y cercano",
      "Cercano y casual",
      "Audaz y diferente",
      "Cálido y humano",
      "Experto y técnico",
    ],
    en: [
      "Professional and approachable",
      "Casual and friendly",
      "Bold and different",
      "Warm and human",
      "Expert and technical",
    ],
  },
  positioning: {
    es: ["Premium", "Gama alta", "Gama media", "Calidad-precio"],
    en: ["Premium", "High end", "Mid market", "Value for money"],
  },
};

/** Capability-first tool discovery (Phase P-B): one business question per
 *  domain. The CEO never chooses a "plugin"; Departify decides the connector. */
const CRM_OPTION_IDS: readonly string[] = [
  "mautic",
  "hubspot",
  "salesforce",
  "pipedrive",
  "zoho",
];

const EMAIL_OPTION_IDS: readonly string[] = ["gmail", "outlook"];

const CALENDAR_OPTION_IDS: readonly string[] = [
  "google_calendar",
  "microsoft_calendar",
];

const DOCUMENTS_OPTION_IDS: readonly string[] = [
  "google_drive",
  "onedrive",
  "dropbox",
];

const MARKETING_OPTION_IDS: readonly string[] = [
  "mautic",
  "mailchimp",
  "brevo",
  "hubspot",
];

const TEAM_OPTION_IDS: readonly string[] = [
  "whatsapp",
  "slack",
  "telegram",
  "microsoft_teams",
  "notion",
];

/** The questions required before onboarding can hand off to the department. */
export const TOOL_DISCOVERY_QUESTION_IDS: readonly string[] = [
  "ops:crm",
  "tools:email",
  "tools:calendar",
  "tools:documents",
  "tools:marketing",
  "tools:team",
];

export function otherOptionLabel(locale: SupportedLocale): string {
  return t(locale, "Otra", "Other");
}

export function noCrmOptionLabel(locale: SupportedLocale): string {
  return t(locale, "No utilizo CRM", "I don't use a CRM");
}

function optionLabels(ids: readonly string[]): string[] {
  return ids.map(
    (id) => TOOL_CATALOG.find((tool) => tool.id === id)?.label ?? id,
  );
}

export function buildCrmQuestion(locale: SupportedLocale): ProgressiveQuestion {
  return {
    id: "ops:crm",
    kind: "crm",
    question: t(
      locale,
      "¿Qué CRM utilizáis?",
      "Which CRM do you use?",
    ),
    component: "choice",
    options: [
      noCrmOptionLabel(locale),
      ...optionLabels(CRM_OPTION_IDS),
      otherOptionLabel(locale),
    ],
    weight: "useful",
  };
}

export function buildEmailQuestion(locale: SupportedLocale): ProgressiveQuestion {
  return {
    id: "tools:email",
    kind: "tools",
    question: t(
      locale,
      "¿Dónde gestionáis el correo?",
      "Where do you manage email?",
    ),
    component: "choice",
    options: [...optionLabels(EMAIL_OPTION_IDS), otherOptionLabel(locale)],
    weight: "useful",
  };
}

export function buildCalendarQuestion(
  locale: SupportedLocale,
): ProgressiveQuestion {
  return {
    id: "tools:calendar",
    kind: "tools",
    question: t(
      locale,
      "¿Qué calendario utilizáis?",
      "Which calendar do you use?",
    ),
    component: "choice",
    options: [...optionLabels(CALENDAR_OPTION_IDS), otherOptionLabel(locale)],
    weight: "useful",
  };
}

export function buildDocumentsQuestion(
  locale: SupportedLocale,
): ProgressiveQuestion {
  return {
    id: "tools:documents",
    kind: "tools",
    question: t(
      locale,
      "¿Dónde guardáis documentos?",
      "Where do you store documents?",
    ),
    component: "choice",
    options: [...optionLabels(DOCUMENTS_OPTION_IDS), otherOptionLabel(locale)],
    weight: "useful",
  };
}

export function buildMarketingQuestion(
  locale: SupportedLocale,
  declaredToolIds?: readonly string[],
): ProgressiveQuestion {
  const options = MARKETING_OPTION_IDS.filter(
    (id) => !declaredToolIds?.includes(id),
  );
  return {
    id: "tools:marketing",
    kind: "tools",
    question: t(
      locale,
      "¿Qué herramientas de marketing utilizáis?",
      "Which marketing tools do you use?",
    ),
    component: "multi_choice",
    options: [...optionLabels(options), otherOptionLabel(locale)],
    weight: "useful",
  };
}

export function buildTeamQuestion(
  locale: SupportedLocale,
): ProgressiveQuestion {
  return {
    id: "tools:team",
    kind: "tools",
    question: t(
      locale,
      "¿Qué herramientas utiliza vuestro equipo?",
      "Which tools does your team use?",
    ),
    component: "multi_choice",
    options: [...optionLabels(TEAM_OPTION_IDS), otherOptionLabel(locale)],
    weight: "useful",
  };
}

export function buildToolDetailQuestion(
  locale: SupportedLocale,
): ProgressiveQuestion {
  return {
    id: "ops:tool_other",
    kind: "tool_detail",
    question: t(locale, "¿Cuál utilizas?", "Which one do you use?"),
    component: "text",
    weight: "useful",
  };
}

export interface DiscoveryConversationState {
  /** Question ids already asked and answered. */
  answered: Set<string>;
  /** Whether the CEO selected "Otra" and owes us the tool name. */
  pendingToolDetail: boolean;
  /** How many DNA questions we have already asked (value over completeness). */
  dnaAsked: number;
}

export function createConversationState(): DiscoveryConversationState {
  return { answered: new Set(), pendingToolDetail: false, dnaAsked: 0 };
}

/** Hard cap: we never interrogate the CEO. */
export const MAX_DNA_QUESTIONS = 3;

/**
 * Only categories Marketing needs to work NOW are worth the CEO's time.
 * Everything below this rank (vision, values, processes…) is `optional`:
 * Marketing keeps learning while it works instead of interrogating.
 */
const MAX_ASKABLE_RANK = 8;

export function weightForCategory(
  category: FindingCategory,
  importance: string,
): QuestionWeight {
  if (BLOCKING_CATEGORIES.includes(category) && importance === "critical") {
    return "blocking";
  }
  if ((CATEGORY_RANK[category] ?? 99) > MAX_ASKABLE_RANK) {
    return "optional";
  }
  if (importance === "critical" || importance === "high") {
    return "useful";
  }
  return "optional";
}

/**
 * Selects the single next question of highest business value, or `null` when
 * Departify already knows enough to start working.
 */
export function selectNextQuestion(
  report: CompanyDiscoveryReport | null,
  state: DiscoveryConversationState,
  locale: SupportedLocale,
  declaredToolIds?: readonly string[],
): ProgressiveQuestion | null {
  if (state.pendingToolDetail && !state.answered.has("ops:tool_other")) {
    return buildToolDetailQuestion(locale);
  }

  const dnaQuestion = report ? selectDnaQuestion(report, state, locale) : null;
  if (dnaQuestion && dnaQuestion.weight === "blocking") {
    return dnaQuestion;
  }

  // Capability-first tool discovery (Phase P-B): one domain at a time.
  if (!state.answered.has("ops:crm")) {
    return buildCrmQuestion(locale);
  }
  if (!state.answered.has("tools:email")) {
    return buildEmailQuestion(locale);
  }
  if (!state.answered.has("tools:calendar")) {
    return buildCalendarQuestion(locale);
  }
  if (!state.answered.has("tools:documents")) {
    return buildDocumentsQuestion(locale);
  }
  if (!state.answered.has("tools:marketing")) {
    return buildMarketingQuestion(locale, declaredToolIds);
  }
  if (!state.answered.has("tools:team")) {
    return buildTeamQuestion(locale);
  }

  return dnaQuestion;
}

/** True when every required tool-discovery question has been answered. */
export function isToolDiscoveryComplete(
  state: DiscoveryConversationState,
): boolean {
  return TOOL_DISCOVERY_QUESTION_IDS.every((id) => state.answered.has(id));
}

function selectDnaQuestion(
  report: CompanyDiscoveryReport,
  state: DiscoveryConversationState,
  locale: SupportedLocale,
): ProgressiveQuestion | null {
  if (state.dnaAsked >= MAX_DNA_QUESTIONS) {
    return null;
  }

  const candidates = report.questions
    .filter((question) => DNA_CATEGORIES.includes(question.category))
    .filter((question) => !state.answered.has(dnaQuestionId(question.category)))
    .map((question) => ({
      category: question.category,
      weight: weightForCategory(question.category, question.importance),
      rank: CATEGORY_RANK[question.category] ?? 99,
    }))
    .filter((candidate) => candidate.weight !== "optional");

  // Deduplicate by category (never ask the same thing twice).
  const seen = new Set<FindingCategory>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.category)) return false;
    seen.add(candidate.category);
    return true;
  });

  unique.sort((a, b) => {
    if (a.weight !== b.weight) return a.weight === "blocking" ? -1 : 1;
    return a.rank - b.rank;
  });

  const next = unique[0];
  if (!next) return null;

  const text = QUESTION_TEXT[next.category];
  const options = CHOICE_OPTIONS[next.category];
  return {
    id: dnaQuestionId(next.category),
    kind: "dna",
    category: next.category,
    question: text ? t(locale, text.es, text.en) : String(next.category),
    component: options ? "choice" : "text",
    ...(options ? { options: locale === "en" ? options.en : options.es } : {}),
    weight: next.weight,
  };
}

export function dnaQuestionId(category: FindingCategory): string {
  return `dna:${category}`;
}

/** True when nothing blocking is left — Marketing may start. */
export function isReadyForMarketing(
  report: CompanyDiscoveryReport | null,
  state: DiscoveryConversationState,
): boolean {
  if (!report) return false;
  return !report.questions.some(
    (question) =>
      DNA_CATEGORIES.includes(question.category) &&
      weightForCategory(question.category, question.importance) === "blocking" &&
      !state.answered.has(dnaQuestionId(question.category)),
  );
}
