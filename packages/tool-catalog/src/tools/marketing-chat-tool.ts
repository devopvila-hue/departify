import type {
  DiscoveryReportRepository,
} from "@departify/business-discovery";
import type {
  LlmMessage,
  LlmRouter,
} from "@departify/llm-router";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface MarketingChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface MarketingChatInput {
  readonly organizationId: string;
  readonly message: string;
  /** Conversation history carried by the host so the Director keeps context. */
  readonly history?: readonly MarketingChatMessage[];
  /** UI/session locale: every visible text must be produced in it. */
  readonly locale?: string;
  /** Extra real context (onboarding goal, tools, connections). */
  readonly extraContext?: string;
}

export interface MarketingChatOutput {
  readonly reply: string;
}

export interface MarketingChatToolOptions {
  readonly repository: DiscoveryReportRepository;
  readonly llmRouter: LlmRouter;
  readonly clock?: () => Date;
}

class MarketingChatUnavailableError extends Error {
  readonly envelope: ToolExecutionErrorEnvelope;
  constructor(message: string) {
    super(message);
    this.name = "MarketingChatUnavailableError";
    this.envelope = {
      code: "execution_failed",
      name: this.name,
      message: this.message,
    };
  }
}

/**
 * `marketing.chat` — the Marketing Director's conversation tool (Sprint 57).
 *
 * The CEO talks to the Department through this tool. It is the imprescindible
 * link that connects the real runtime (AgentToolBridge → Tool Runtime → Core
 * Tool Catalog) with the real LLM Router and provider, grounding the reply in
 * the Company DNA that the discovery pipeline produced. No hardcoded answers:
 * the Director replies from the actual business context stored in the
 * DiscoveryReportRepository, plus the conversation history carried by the host.
 */
export function createMarketingChatToolDefinition(
  options: MarketingChatToolOptions,
): ToolDefinition<MarketingChatInput, MarketingChatOutput> {
  const clock = options.clock ?? (() => new Date());
  return {
    id: "marketing.chat",
    version: "1.0.0",
    metadata: {
      displayName: "Marketing Chat",
      description:
        "Talk with the Marketing Director about the company, using the real business context discovered during onboarding.",
      tags: ["marketing", "chat", "business"],
    },
    capabilities: ["retryable", "long_running"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId", "message"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        locale: { type: "string" },
        extraContext: { type: "string" },
        history: {
          type: "array",
          items: {
            type: "object",
            required: ["role", "content"],
            properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string" },
            },
          },
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["reply"],
      properties: {
        reply: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 60_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: MarketingChatInput,
    ): Promise<MarketingChatOutput> => {
      const businessContext = buildBusinessContext(
        args.organizationId,
        options.repository,
      );
      if (!businessContext) {
        throw new MarketingChatUnavailableError(
          `No business context found for organization '${args.organizationId}'.`,
        );
      }

      const history = args.history ?? [];
      const messages: LlmMessage[] = [
        {
          role: "system",
          content: buildSystemPrompt(
            args.extraContext && args.extraContext.trim().length > 0
              ? `${businessContext}\n${args.extraContext.trim()}`
              : businessContext,
            args.locale,
          ),
        },
        ...history.map((entry) => ({
          role: entry.role as LlmMessage["role"],
          content: entry.content,
        })),
        { role: "user", content: args.message },
      ];

      const response = await options.llmRouter.chat({
        type: "chat",
        requestId: `req_mkt_chat_${clock().getTime()}`,
        requiredCapabilities: ["chat"],
        messages,
        stream: false,
      });

      return { reply: response.message };
    },
  };
}

export function buildBusinessContext(
  organizationId: string,
  repository: DiscoveryReportRepository,
): string | null {
  const records = repository.findByOrganizationId(organizationId);
  if (records.length === 0) {
    return null;
  }
  const mostRecent = [...records].sort((a, b) =>
    b.savedAt.getTime() - a.savedAt.getTime(),
  )[0];
  if (!mostRecent) {
    return null;
  }

  const dna = mostRecent.report.companyDna;
  const parts: string[] = [];
  if (dna.mission?.statement) parts.push(`Misión: ${dna.mission.statement}`);
  if (dna.vision?.statement) parts.push(`Visión: ${dna.vision.statement}`);
  if (dna.valueProposition?.statement) {
    parts.push(`Propuesta de valor: ${dna.valueProposition.statement}`);
  }
  if (dna.products.length > 0) {
    parts.push(
      `Productos: ${dna.products.map((p) => p.name).join(", ")}`,
    );
  }
  if (dna.services.length > 0) {
    parts.push(
      `Servicios: ${dna.services.map((s) => s.name).join(", ")}`,
    );
  }
  if (dna.market?.industry) parts.push(`Mercado: ${dna.market.industry}`);
  if (dna.market?.competition) {
    parts.push(`Competencia: ${dna.market.competition}`);
  }
  if (dna.idealCustomer) {
    parts.push(
      `Cliente ideal: ${dna.idealCustomer.demographics.join(", ")}`,
    );
  }
  if (dna.tone) {
    parts.push(`Tono: ${dna.tone.personality.join(", ")}`);
  }
  if (dna.positioning?.statement) {
    parts.push(`Posicionamiento: ${dna.positioning.statement}`);
  }
  if (dna.weaknesses.length > 0) {
    parts.push(
      `Puntos débiles: ${dna.weaknesses.map((w) => w.description).join("; ")}`,
    );
  }

  const gaps = mostRecent.report.gaps;
  if (gaps.length > 0) {
    parts.push(
      `Información pendiente: ${gaps.map((g) => g.description).join("; ")}`,
    );
  }

  const questions = mostRecent.report.questions;
  if (questions.length > 0) {
    parts.push(
      `Preguntas abiertas para el CEO: ${questions
        .map((q) => q.question)
        .join(" | ")}`,
    );
  }

  return parts.join("\n");
}

function buildSystemPrompt(context: string, locale?: string): string {
  const language = locale === "en" ? "English" : "Spanish (español)";
  return [
    `Answer ALWAYS in ${language}. Never mix languages.`,
    "Responde directamente, SIN razonar en voz alta ni mostrar tus pasos de pensamiento. Da la respuesta final de inmediato.",
    "Eres el Director del Departamento de Marketing de esta empresa.",
    "Respondes al CEO basándote ÚNICAMENTE en el conocimiento real del negocio que se te ha proporcionado.",
    "Usa hechos concretos del contexto. Si necesitas información que no está en el contexto, pídela en lugar de inventarla.",
    "Da prioridades concretas y razonadas para el Departamento de Marketing.",
    "",
    "CONTEXTO REAL DEL NEGOCIO:",
    context,
  ].join("\n");
}
