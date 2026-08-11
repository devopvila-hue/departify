/**
 * Web analysis for Customer Zero — real URL investigation (Sprint 57).
 *
 * Fetches the company's website, extracts meaningful content, and uses the
 * real LLM to interpret it into structured business facts. This is REAL
 * research: no fixtures, no hardcoded content, no simulated answers.
 */
import type { LlmRouter } from "@departify/llm-router";
import { localeInstruction, type SupportedLocale } from "./locale.js";

export interface ExtractedWebsite {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly headings: readonly string[];
  readonly paragraphs: readonly string[];
  readonly links: readonly string[];
}

export interface InterpretedBusiness {
  companyName?: string;
  activity?: string;
  mission?: string;
  products?: readonly string[];
  services?: readonly string[];
  market?: string;
  positioning?: string;
  targetAudience?: readonly string[];
  tone?: readonly string[];
  locations?: readonly string[];
  valueProposition?: string;
}

export interface WebAnalysis {
  readonly extracted: ExtractedWebsite;
  readonly interpreted: InterpretedBusiness;
  readonly rawData: Readonly<Record<string, unknown>>;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 512_000;

/**
 * Fetches a real website and extracts meaningful content. Uses Node's global
 * fetch with a timeout and a browser-ish User-Agent. Returns the extracted
 * text plus a compact digest for the LLM.
 */
export async function fetchAndExtractWebsite(
  url: string,
): Promise<ExtractedWebsite> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; DepartifyCustomerZero/1.0; +https://departify.example)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    // NEVER surface the raw Node fetch error ("fetch failed") to the CEO.
    // The URL may be wrong, down, or slow — the company and the intake
    // survive and the CEO gets a business-readable recovery path.
    throw new Error(
      "No hemos podido acceder a la web de tu empresa. Comprueba la dirección o elige «no tengo web».",
    );
  }

  if (!response.ok) {
    throw new Error(
      `No hemos podido leer la web de tu empresa (respuesta ${response.status}).`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error(
      "La dirección no devuelve una página web. Comprueba la URL o elige «no tengo web».",
    );
  }

  const buffer = await response.arrayBuffer();
  const html = new TextDecoder("utf-8")
    .decode(buffer)
    .slice(0, MAX_BYTES);

  return extractHtml(html, url);
}

/**
 * Minimal, dependency-free HTML extraction. It pulls the real title, meta
 * description, headings, paragraphs and outbound links, and strips script /
 * style / navigation noise. Intentionally NOT a universal crawler.
 */
export function extractHtml(html: string, url: string): ExtractedWebsite {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");

  const title = firstMatch(withoutNoise, /<title[^>]*>([^<]*)<\/title>/i);
  const description = firstMatch(
    withoutNoise,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  );
  const headings = matches(withoutNoise, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)
    .map(stripTags)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 20);
  const paragraphs = matches(withoutNoise, /<p[^>]*>([\s\S]*?)<\/p>/gi)
    .map(stripTags)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 30);
  const links = matches(
    withoutNoise,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi,
  )
    .map((href) => href.replace(/^https?:\/\//i, "").split("/")[0] ?? href)
    .filter((host) => host !== new URL(url).hostname)
    .slice(0, 10);

  return { url, title, description, headings, paragraphs, links };
}

/**
 * Interprets the extracted website content into structured business facts
 * using the real LLM Router. On any failure the analysis degrades to the
 * deterministic fields (title → companyName, description → value proposition)
 * rather than inventing content.
 */
export async function interpretWebsite(
  extracted: ExtractedWebsite,
  llmRouter: LlmRouter,
  locale: SupportedLocale = "es",
): Promise<InterpretedBusiness> {
  const fallback: InterpretedBusiness = {};
  if (extracted.title) {
    fallback.companyName = extracted.title;
  }
  if (extracted.description) {
    fallback.valueProposition = extracted.description;
  }

  const digest = buildDigest(extracted);
  if (digest.length === 0) {
    return fallback;
  }

  try {
    const response = await llmRouter.chat({
      type: "chat",
      requestId: `req_web_${Date.now()}`,
      requiredCapabilities: ["chat"],
      messages: [
        {
          role: "system",
          content:
            "You extract business information from a company website. " +
            "Reply ONLY with a valid JSON object. Use exactly these keys when present: " +
            "companyName, activity, mission, products (array of strings), services (array of strings), " +
            "market, positioning, targetAudience (array of strings), tone (array of strings), " +
            "locations (array of strings), valueProposition. " +
            "Never invent facts that are not on the page. If a field is unknown, omit it. " +
            localeInstruction(locale),
        },
        { role: "user", content: digest },
      ],
      stream: false,
    });

    const parsed = parseJsonObject(response.message);
    return sanitizeInterpretation({ ...fallback, ...parsed });
  } catch {
    return fallback;
  }
}

/**
 * The LLM sometimes returns numbers or nested objects for text fields. This
 * coerces every interpreted value to the string / string-array shape the DNA
 * pipeline expects, ignoring anything unusable.
 */
function sanitizeInterpretation(
  input: Record<string, unknown>,
): InterpretedBusiness {
  const out: InterpretedBusiness = {};
  const single = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : typeof value === "number"
        ? String(value)
        : undefined;
  const list = (value: unknown): readonly string[] | undefined => {
    if (Array.isArray(value)) {
      const items = value
        .map((item) => (typeof item === "string" ? item.trim() : String(item)))
        .filter((item) => item.length > 0);
      return items.length > 0 ? items : undefined;
    }
    const item = single(value);
    return item ? [item] : undefined;
  };

  const companyName = single(input.companyName);
  const activity = single(input.activity);
  const mission = single(input.mission);
  const market = single(input.market);
  const positioning = single(input.positioning);
  const valueProposition = single(input.valueProposition);
  const products = list(input.products);
  const services = list(input.services);
  const targetAudience = list(input.targetAudience);
  const tone = list(input.tone);
  const locations = list(input.locations);

  if (companyName) out.companyName = companyName;
  if (activity) out.activity = activity;
  if (mission) out.mission = mission;
  if (market) out.market = market;
  if (positioning) out.positioning = positioning;
  if (valueProposition) out.valueProposition = valueProposition;
  if (products) out.products = products;
  if (services) out.services = services;
  if (targetAudience) out.targetAudience = targetAudience;
  if (tone) out.tone = tone;
  if (locations) out.locations = locations;

  return out;
}

/**
 * Maps the interpreted facts into the DNA-shaped `rawData` the discovery
 * pipeline understands (Sprint 55). Confidence comes from the website source;
 * the CEO corrections later override with `user_input`.
 */
/**
 * Interprets the founder's own description of the business he is creating
 * (no website yet). Same structured output, same locale rule — the real LLM,
 * never a simulated web analysis.
 */
export async function interpretDescription(
  description: string,
  llmRouter: LlmRouter,
  locale: SupportedLocale = "es",
  companyName?: string,
): Promise<InterpretedBusiness> {
  const fallback: InterpretedBusiness = {};
  if (companyName) {
    fallback.companyName = companyName;
  }
  const text = description.trim();
  if (text.length === 0) {
    return fallback;
  }

  try {
    const response = await llmRouter.chat({
      type: "chat",
      requestId: `req_idea_${Date.now()}`,
      requiredCapabilities: ["chat"],
      messages: [
        {
          role: "system",
          content:
            "A founder describes the business he is building. Extract the " +
            "business information. Reply ONLY with a valid JSON object using " +
            "exactly these keys when present: companyName, activity, mission, " +
            "products (array of strings), services (array of strings), market, " +
            "positioning, targetAudience (array of strings), tone (array of " +
            "strings), locations (array of strings), valueProposition. " +
            "Never invent facts the founder did not say. Omit unknown fields. " +
            localeInstruction(locale),
        },
        { role: "user", content: text },
      ],
      stream: false,
    });

    const parsed = parseJsonObject(response.message);
    return sanitizeInterpretation({ ...fallback, ...parsed });
  } catch {
    return fallback;
  }
}

export function buildRawDataFromInterpretation(
  interpreted: InterpretedBusiness,
): Readonly<Record<string, unknown>> {
  const rawData: Record<string, unknown> = {};

  if (interpreted.mission) {
    rawData.mission = {
      statement: interpreted.mission,
      confidence: websiteConfidence(),
    };
  }
  if (interpreted.valueProposition) {
    rawData.valueProposition = {
      statement: interpreted.valueProposition,
      differentiation: [],
      confidence: websiteConfidence(),
    };
  }
  if (interpreted.market) {
    rawData.market = {
      industry: interpreted.market,
      competition: "medium",
      confidence: websiteConfidence(),
    };
  }
  if (interpreted.positioning) {
    rawData.positioning = {
      statement: interpreted.positioning,
      differentiation: [],
      confidence: websiteConfidence(),
    };
  }
  if (interpreted.products && interpreted.products.length > 0) {
    rawData.products = interpreted.products.map((name, index) => ({
      id: `product_${index + 1}`,
      name,
      description: name,
      targetAudience: interpreted.targetAudience?.[0] ?? "",
      keyFeatures: [],
      stage: "launched",
      confidence: websiteConfidence(),
    }));
  }
  if (interpreted.services && interpreted.services.length > 0) {
    rawData.services = interpreted.services.map((name, index) => ({
      id: `service_${index + 1}`,
      name,
      description: name,
      deliveryMethod: "unknown",
      confidence: websiteConfidence(),
    }));
  }
  if (interpreted.targetAudience && interpreted.targetAudience.length > 0) {
    rawData.idealCustomer = {
      demographics: interpreted.targetAudience,
      psychographics: [],
      painPoints: [],
      buyingBehavior: [],
      confidence: websiteConfidence(),
    };
  }
  if (interpreted.tone && interpreted.tone.length > 0) {
    rawData.tone = {
      personality: interpreted.tone,
      voice: interpreted.tone[0] ?? "neutral",
      styleExamples: [],
      confidence: websiteConfidence(),
    };
  }

  return rawData;
}

function websiteConfidence(): {
  readonly level: "medium";
  readonly source: "website";
  readonly lastVerified: string;
} {
  return {
    level: "medium",
    source: "website",
    lastVerified: new Date().toISOString(),
  };
}

function buildDigest(extracted: ExtractedWebsite): string {
  const parts: string[] = [];
  if (extracted.title) parts.push(`TITLE: ${extracted.title}`);
  if (extracted.description) parts.push(`DESCRIPTION: ${extracted.description}`);
  if (extracted.headings.length > 0) {
    parts.push(`HEADINGS:\n${extracted.headings.join("\n")}`);
  }
  if (extracted.paragraphs.length > 0) {
    parts.push(`TEXT:\n${extracted.paragraphs.join("\n")}`);
  }
  return parts.join("\n\n").slice(0, 30_000);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function matches(html: string, regex: RegExp): readonly string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    out.push(match[1] ?? match[0]);
  }
  return out;
}

function firstMatch(html: string, regex: RegExp): string {
  const match = regex.exec(html);
  return (match?.[1] ?? "").trim();
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(text: string): string {
  return text.trim().replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}
