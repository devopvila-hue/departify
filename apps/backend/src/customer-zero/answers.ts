/**
 * CEO answers → Company DNA persistence — Sprint hotfix.
 *
 * Maps the CEO's answers to the mandatory discovery questions into the
 * DNA-shaped `rawData` the discovery pipeline understands, marking them as
 * verified `user_input`. Explicit CEO answers always prevail over the
 * website-based inferences when the same section is present (goal rule).
 */
import type { FindingCategory } from "@departify/business-discovery";

const DNA_CATEGORY_SET: ReadonlySet<FindingCategory> = new Set([
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
]);

function userInputConfidence(): {
  readonly level: "verified";
  readonly source: "user_input";
  readonly lastVerified: string;
} {
  return {
    level: "verified",
    source: "user_input",
    lastVerified: new Date().toISOString(),
  };
}

/**
 * Builds the DNA-shaped rawData additions from the CEO's answers. Each answer
 * is a `{ category: text }` map. Unknown categories and empty answers are
 * ignored. The result is merged over the website-inferred rawData so the CEO's
 * explicit information wins.
 */
export function buildAnswersRawData(
  answers: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const confidence = userInputConfidence();
  const out: Record<string, unknown> = {};

  for (const [categoryKey, rawValue] of Object.entries(answers)) {
    const category = categoryKey as FindingCategory;
    if (!DNA_CATEGORY_SET.has(category)) {
      continue;
    }
    const text = typeof rawValue === "string" ? rawValue.trim() : "";
    if (text.length === 0) {
      continue;
    }

    switch (category) {
      case "mission":
        out.mission = { statement: text, confidence };
        break;
      case "vision":
        out.vision = { statement: text, confidence };
        break;
      case "values":
        out.values = splitValues(text).map((name, index) => ({
          id: `value_${index + 1}`,
          name,
          description: name,
          confidence,
        }));
        break;
      case "value_proposition":
        out.valueProposition = {
          statement: text,
          differentiation: [],
          confidence,
        };
        break;
      case "products":
        out.products = splitItems(text).map((name, index) => ({
          id: `product_${index + 1}`,
          name,
          description: name,
          targetAudience: "",
          keyFeatures: [],
          stage: "launched",
          confidence,
        }));
        break;
      case "services":
        out.services = splitItems(text).map((name, index) => ({
          id: `service_${index + 1}`,
          name,
          description: name,
          deliveryMethod: "unknown",
          confidence,
        }));
        break;
      case "market":
        out.market = {
          industry: text,
          competition: "medium",
          confidence,
        };
        break;
      case "ideal_customer":
        out.idealCustomer = {
          demographics: splitItems(text),
          psychographics: [],
          painPoints: [],
          buyingBehavior: [],
          confidence,
        };
        break;
      case "tone":
        out.tone = {
          personality: splitItems(text),
          voice: splitItems(text)[0] ?? text,
          styleExamples: [],
          confidence,
        };
        break;
      case "positioning":
        out.positioning = { statement: text, differentiation: [], confidence };
        break;
      case "strengths":
        out.strengths = splitItems(text).map((name, index) => ({
          id: `strength_${index + 1}`,
          category: "operations",
          description: name,
          evidence: [],
          confidence,
        }));
        break;
      case "weaknesses":
        out.weaknesses = splitItems(text).map((name, index) => ({
          id: `weakness_${index + 1}`,
          category: "operations",
          description: name,
          confidence,
        }));
        break;
      case "objectives":
        out.objectives = splitItems(text).map((name, index) => ({
          id: `objective_${index + 1}`,
          title: name,
          description: name,
          timeframe: "unknown",
          priority: "high",
          status: "planned",
          confidence,
        }));
        break;
      case "processes":
        out.processes = splitItems(text).map((name, index) => ({
          id: `process_${index + 1}`,
          name,
          description: name,
          maturity: "defined",
          confidence,
        }));
        break;
      default:
        break;
    }
  }

  return out;
}

/** Splits a free-text answer into values on commas / semicolons / newlines. */
function splitValues(text: string): readonly string[] {
  const items = text
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : [text];
}

/** Splits a free-text answer into a product/service list of named items. */
function splitItems(text: string): readonly string[] {
  return splitValues(text);
}
