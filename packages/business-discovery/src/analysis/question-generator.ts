/**
 * Question Generator — deterministic question generation.
 *
 * Generates adaptive questions based on detected gaps using deterministic
 * rules, not AI inference. Each question is crafted to fill specific
 * information gaps.
 */

import type {
  DiscoveryQuestion,
  FindingCategory,
} from "../contracts/discovery-types.js";
import type { GapAnalysisResult } from "./gap-analysis.js";

/**
 * Question template for a category.
 */
interface QuestionTemplate {
  readonly category: FindingCategory;
  readonly questions: readonly string[];
  readonly type: DiscoveryQuestion["type"];
  readonly options?: readonly string[];
  readonly priorityBase: number;
  readonly contextPrefix: string;
}

/**
 * Define all question templates.
 */
const QUESTION_TEMPLATES: readonly QuestionTemplate[] = [
  {
    category: "mission",
    questions: [
      "What is your company's mission statement?",
      "Why does your company exist beyond making money?",
      "What problem does your company solve for the world?",
    ],
    type: "open",
    priorityBase: 100,
    contextPrefix: "Understanding the company's core purpose",
  },
  {
    category: "vision",
    questions: [
      "Where do you see your company in 5 years?",
      "What impact do you want your company to have?",
      "What would success look like for your company?",
    ],
    type: "open",
    priorityBase: 95,
    contextPrefix: "Understanding the company's aspirations",
  },
  {
    category: "values",
    questions: [
      "What are your company's core values?",
      "What principles guide your company's decisions?",
      "What does your company stand for?",
    ],
    type: "open",
    priorityBase: 95,
    contextPrefix: "Understanding the company's guiding principles",
  },
  {
    category: "value_proposition",
    questions: [
      "What unique value does your company provide to customers?",
      "Why should customers choose you over competitors?",
      "What makes your company different?",
    ],
    type: "open",
    priorityBase: 100,
    contextPrefix: "Understanding the company's unique value",
  },
  {
    category: "products",
    questions: [
      "What products does your company offer?",
      "Describe your main product offerings.",
      "What are your flagship products?",
    ],
    type: "open",
    priorityBase: 100,
    contextPrefix: "Understanding the company's products",
  },
  {
    category: "services",
    questions: [
      "What services does your company offer?",
      "Describe your service offerings.",
      "What services do you provide to customers?",
    ],
    type: "open",
    priorityBase: 60,
    contextPrefix: "Understanding the company's services",
  },
  {
    category: "market",
    questions: [
      "What industry does your company operate in?",
      "Who are your main competitors?",
      "What is your target market size?",
    ],
    type: "open",
    priorityBase: 90,
    contextPrefix: "Understanding the company's market position",
  },
  {
    category: "ideal_customer",
    questions: [
      "Who is your ideal customer?",
      "Describe your target customer profile.",
      "Who gets the most value from your product/service?",
    ],
    type: "open",
    priorityBase: 90,
    contextPrefix: "Understanding the company's customer",
  },
  {
    category: "tone",
    questions: [
      "How would you describe your brand's personality?",
      "What tone does your company use in communication?",
      "Is your brand formal or casual?",
    ],
    type: "multiple_choice",
    options: ["Professional/Formal", "Friendly/Casual", "Bold/Edgy", "Warm/Approachable", "Expert/Authoritative"],
    priorityBase: 50,
    contextPrefix: "Understanding the company's communication style",
  },
  {
    category: "positioning",
    questions: [
      "How does your company position itself in the market?",
      "Are you premium, mid-market, or budget?",
      "What is your market positioning strategy?",
    ],
    type: "multiple_choice",
    options: ["Premium/Luxury", "High-end", "Mid-market", "Value/Budget"],
    priorityBase: 90,
    contextPrefix: "Understanding the company's market positioning",
  },
  {
    category: "strengths",
    questions: [
      "What are your company's main strengths?",
      "What advantages does your company have?",
      "What does your company do exceptionally well?",
    ],
    type: "open",
    priorityBase: 50,
    contextPrefix: "Understanding the company's strengths",
  },
  {
    category: "weaknesses",
    questions: [
      "What challenges does your company face?",
      "What areas need improvement?",
      "What are your company's weaknesses?",
    ],
    type: "open",
    priorityBase: 40,
    contextPrefix: "Understanding the company's challenges",
  },
  {
    category: "objectives",
    questions: [
      "What are your company's main objectives?",
      "What goals are you working toward?",
      "What are your key business priorities?",
    ],
    type: "open",
    priorityBase: 90,
    contextPrefix: "Understanding the company's goals",
  },
  {
    category: "processes",
    questions: [
      "What are your key business processes?",
      "How does your company deliver value?",
      "Describe your main operational processes.",
    ],
    type: "open",
    priorityBase: 40,
    contextPrefix: "Understanding the company's operations",
  },
  {
    category: "leadership_style",
    questions: [
      "How would you describe your leadership style?",
      "How do you lead your team?",
    ],
    type: "multiple_choice",
    options: [
      "Visionary — inspire with future vision",
      "Transformational — drive change",
      "Servant — support the team",
      "Democratic — collaborative decisions",
      "Autocratic — directive approach",
    ],
    priorityBase: 70,
    contextPrefix: "Understanding leadership approach",
  },
  {
    category: "priorities",
    questions: [
      "What are your top business priorities right now?",
      "What matters most to you at this moment?",
      "What are you focusing on?",
    ],
    type: "ranking",
    priorityBase: 100,
    contextPrefix: "Understanding current priorities",
  },
  {
    category: "philosophy",
    questions: [
      "What are your core business beliefs?",
      "What principles guide your business decisions?",
      "What are your non-negotiables?",
    ],
    type: "open",
    priorityBase: 60,
    contextPrefix: "Understanding business philosophy",
  },
  {
    category: "risk_tolerance",
    questions: [
      "How do you approach risk in business?",
      "What is your risk tolerance?",
      "Are you risk-averse or risk-tolerant?",
    ],
    type: "multiple_choice",
    options: [
      "Minimal — avoid risk whenever possible",
      "Low — cautious but calculated",
      "Moderate — balanced approach",
      "High — embrace opportunities",
      "Aggressive — risk is necessary",
    ],
    priorityBase: 90,
    contextPrefix: "Understanding risk approach",
  },
  {
    category: "delegation_style",
    questions: [
      "How do you delegate work?",
      "What do you prefer to keep vs delegate?",
    ],
    type: "multiple_choice",
    options: [
      "Hands-off — full delegation",
      "Empower — trust with oversight",
      "Involved — regular check-ins",
      "Selective — delegate specific tasks",
    ],
    priorityBase: 50,
    contextPrefix: "Understanding delegation approach",
  },
  {
    category: "decision_making",
    questions: [
      "How do you make important decisions?",
      "What is your decision-making process?",
    ],
    type: "multiple_choice",
    options: [
      "Intuitive — gut feeling",
      "Analytical — data-driven",
      "Collaborative — team input",
      "Consultative — seek advice then decide",
      "Command — decisive and directive",
    ],
    priorityBase: 90,
    contextPrefix: "Understanding decision-making style",
  },
  {
    category: "communication",
    questions: [
      "How do you prefer to receive updates?",
      "What communication format works best for you?",
    ],
    type: "multiple_choice",
    options: [
      "Executive summary — brief highlights",
      "Key points — main takeaways",
      "Comprehensive — full details",
      "Raw data — let me analyze",
    ],
    priorityBase: 90,
    contextPrefix: "Understanding communication preferences",
  },
  {
    category: "preferences",
    questions: [
      "What information do you need in your dashboard?",
      "What alerts are important to you?",
      "How frequently do you want updates?",
    ],
    type: "multiple_choice",
    options: ["Real-time", "Daily", "Weekly", "As-needed"],
    priorityBase: 50,
    contextPrefix: "Understanding working preferences",
  },
] as const;

/**
 * Priority adjustments based on gap importance.
 */
const IMPORTANCE_PRIORITY_BOOST: Readonly<
  Record<DiscoveryQuestion["importance"], number>
> = {
  critical: 50,
  high: 30,
  medium: 10,
  low: 0,
} as const;

/**
 * Generate a unique question ID.
 */
function generateQuestionId(gapId: string, index: number): string {
  return `q_${gapId}_${index}`;
}

/**
 * Generate questions for a specific gap.
 */
function generateQuestionsForGap(
  gapId: string,
  category: FindingCategory,
  importance: DiscoveryQuestion["importance"],
  maxQuestions: number = 3,
): DiscoveryQuestion[] {
  const template = QUESTION_TEMPLATES.find((t) => t.category === category);
  if (!template) {
    return [];
  }

  const priorityBoost = IMPORTANCE_PRIORITY_BOOST[importance];
  const questions: DiscoveryQuestion[] = [];

  const questionCount = Math.min(maxQuestions, template.questions.length);
  for (let i = 0; i < questionCount; i++) {
    const questionText = template.questions[i];
    if (!questionText) continue;

    const baseQuestion = {
      id: generateQuestionId(gapId, i),
      gapId,
      category,
      question: questionText,
      type: template.type,
      priority: template.priorityBase + priorityBoost - i * 5,
      context: `${template.contextPrefix}: ${importance} priority`,
      importance,
    };

    const question: DiscoveryQuestion = template.options
      ? { ...baseQuestion, options: template.options }
      : baseQuestion;

    questions.push(question);
  }

  return questions;
}

/**
 * Generate questions based on gap analysis results.
 */
export function generateQuestions(
  gapAnalysis: GapAnalysisResult,
  options: {
    readonly maxQuestionsPerGap?: number;
    readonly includeLowPriority?: boolean;
    readonly maxTotalQuestions?: number;
  } = {},
): DiscoveryQuestion[] {
  const {
    maxQuestionsPerGap = 3,
    includeLowPriority = false,
    maxTotalQuestions = 20,
  } = options;

  let allQuestions: DiscoveryQuestion[] = [];

  // Sort gaps by importance and ID for consistency
  const sortedGaps = [...gapAnalysis.gaps].sort((a, b) => {
    const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const importanceDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
    if (importanceDiff !== 0) return importanceDiff;
    return a.id.localeCompare(b.id);
  });

  for (const gap of sortedGaps) {
    // Skip low importance gaps if not requested
    if (!includeLowPriority && gap.importance === "low") {
      continue;
    }

    const gapQuestions = generateQuestionsForGap(
      gap.id,
      gap.category,
      gap.importance,
      maxQuestionsPerGap,
    );
    allQuestions = [...allQuestions, ...gapQuestions];

    // Stop if we've reached the max
    if (allQuestions.length >= maxTotalQuestions) {
      break;
    }
  }

  // Trim to max total questions
  if (allQuestions.length > maxTotalQuestions) {
    allQuestions = allQuestions.slice(0, maxTotalQuestions);
  }

  // Sort final questions by priority
  allQuestions.sort((a, b) => b.priority - a.priority);

  return allQuestions;
}

/**
 * Generate questions for a specific category only.
 */
export function generateQuestionsForCategory(
  category: FindingCategory,
  gapId?: string,
): DiscoveryQuestion[] {
  const effectiveGapId = gapId ?? `gap_${category}_${Date.now()}`;
  return generateQuestionsForGap(effectiveGapId, category, "high");
}

/**
 * Get question templates by category.
 */
export function getQuestionTemplateByCategory(
  category: FindingCategory,
): QuestionTemplate | undefined {
  return QUESTION_TEMPLATES.find((t) => t.category === category);
}

/**
 * Get all available question categories.
 */
export function getAllQuestionCategories(): readonly FindingCategory[] {
  return QUESTION_TEMPLATES.map((t) => t.category);
}

/**
 * Calculate question priority based on gap importance.
 */
export function calculateQuestionPriority(
  basePriority: number,
  importance: DiscoveryQuestion["importance"],
): number {
  return basePriority + IMPORTANCE_PRIORITY_BOOST[importance];
}
