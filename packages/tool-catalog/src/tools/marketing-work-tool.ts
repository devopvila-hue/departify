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
import { buildBusinessContext } from "./marketing-chat-tool.js";

/**
 * Marketing work tools — the Marketing Director turns the CEO's business
 * intention into structured work (Sprint goal Fases 4-6).
 *
 * `marketing.plan` interprets the goal using the real Company DNA and returns
 * a concrete work plan where every item is either executable by Marketing
 * today (analysis/planning/research, no external side effect) or requires the
 * CEO's approval (anything that publishes, sends, spends or touches an
 * external system).
 *
 * `marketing.execute` produces the actual deliverable for an executable item,
 * grounded in the real Company DNA — never a fake result. Items that need a
 * capability that is not connected are reported honestly as unavailable
 * instead of being simulated.
 */

export interface MarketingWorkItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "analysis" | "creation" | "external_action";
  /** What the item produces / touches. Used for honest availability. */
  readonly capability?: string;
}

export interface MarketingPlanInput {
  readonly organizationId: string;
  /** The CEO's business intention, e.g. "Necesito conseguir más clientes." */
  readonly goal: string;
}

export interface MarketingPlanOutput {
  readonly summary: string;
  readonly items: readonly MarketingWorkItem[];
}

export interface MarketingExecuteInput {
  readonly organizationId: string;
  readonly item: MarketingWorkItem;
}

export interface MarketingExecuteOutput {
  /** The real deliverable produced by the Director for this item. */
  readonly result: string;
}

export interface MarketingWorkToolOptions {
  readonly repository: DiscoveryReportRepository;
  readonly llmRouter: LlmRouter;
  readonly clock?: () => Date;
}

class MarketingWorkUnavailableError extends Error {
  readonly envelope: ToolExecutionErrorEnvelope;
  constructor(message: string) {
    super(message);
    this.name = "MarketingWorkUnavailableError";
    this.envelope = {
      code: "execution_failed",
      name: this.name,
      message: this.message,
    };
  }
}

/**
 * `marketing.plan` — interpret the CEO's goal into a structured Marketing
 * work plan grounded in the real Company DNA. No fake execution: each item is
 * classified so the host can run executable items and gate the rest.
 */
export function createMarketingPlanToolDefinition(
  options: MarketingWorkToolOptions,
): ToolDefinition<MarketingPlanInput, MarketingPlanOutput> {
  const clock = options.clock ?? (() => new Date());
  return {
    id: "marketing.plan",
    version: "1.0.0",
    metadata: {
      displayName: "Marketing Plan",
      description:
        "Interpreta el objetivo del CEO y crea un plan de trabajo concreto del Departamento de Marketing.",
      tags: ["marketing", "plan", "business"],
    },
    capabilities: ["retryable", "long_running"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId", "goal"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        goal: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["summary", "items"],
      properties: {
        summary: { type: "string" },
        items: { type: "array" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 60_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: MarketingPlanInput,
    ): Promise<MarketingPlanOutput> => {
      const businessContext = buildBusinessContext(
        args.organizationId,
        options.repository,
      );
      if (!businessContext) {
        throw new MarketingWorkUnavailableError(
          `No business context found for organization '${args.organizationId}'.`,
        );
      }

      const messages: LlmMessage[] = [
        {
          role: "system",
          content: buildPlanSystemPrompt(businessContext),
        },
        {
          role: "user",
          content:
            `Objetivo del CEO: ${args.goal}\n\n` +
            "Crea el plan de trabajo del Departamento de Marketing.",
        },
      ];

      const response = await options.llmRouter.chat({
        type: "chat",
        requestId: `req_mkt_plan_${clock().getTime()}`,
        requiredCapabilities: ["chat"],
        messages,
        stream: false,
      });

      const parsed = parsePlanJson(response.message);
      if (!parsed || !parsed.items || parsed.items.length === 0) {
        throw new MarketingWorkUnavailableError(
          "Marketing could not produce a plan from the CEO's goal.",
        );
      }
      return {
        summary: parsed.summary ?? "",
        items: parsed.items,
      };
    },
  };
}

/**
 * `marketing.execute` — produce the real deliverable for one executable work
 * item, grounded in the Company DNA. Never fabricates results; if the item
 * needs an unavailable capability the Director says so honestly.
 */
export function createMarketingExecuteToolDefinition(
  options: MarketingWorkToolOptions,
): ToolDefinition<MarketingExecuteInput, MarketingExecuteOutput> {
  const clock = options.clock ?? (() => new Date());
  return {
    id: "marketing.execute",
    version: "1.0.0",
    metadata: {
      displayName: "Marketing Execute",
      description:
        "Produce el entregable real de un elemento de trabajo del Departamento de Marketing.",
      tags: ["marketing", "execute", "business"],
    },
    capabilities: ["retryable", "long_running"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId", "item"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        item: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["result"],
      properties: {
        result: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 90_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: MarketingExecuteInput,
    ): Promise<MarketingExecuteOutput> => {
      const businessContext = buildBusinessContext(
        args.organizationId,
        options.repository,
      );
      if (!businessContext) {
        throw new MarketingWorkUnavailableError(
          `No business context found for organization '${args.organizationId}'.`,
        );
      }

      const messages: LlmMessage[] = [
        {
          role: "system",
          content: buildExecuteSystemPrompt(businessContext),
        },
        {
          role: "user",
          content:
            `Trabajo: ${args.item.title}\n` +
            `Descripción: ${args.item.description}\n\n` +
            "Produce el entregable final, completo y accionable para el CEO.",
        },
      ];

      const response = await options.llmRouter.chat({
        type: "chat",
        requestId: `req_mkt_exec_${clock().getTime()}`,
        requiredCapabilities: ["chat"],
        messages,
        stream: false,
      });

      return { result: response.message };
    },
  };
}

function buildPlanSystemPrompt(context: string): string {
  return [
    "Eres el Director del Departamento de Marketing de esta empresa.",
    "El CEO expresa un objetivo de negocio. Tú decides internamente CÓMO conseguirlo.",
    "Crea un plan de trabajo CONCRETO y priorizado, basándote ÚNICAMENTE en el contexto real del negocio.",
    "No inventes hechos de la empresa. Usa el contexto proporcionado.",
    "",
    "Responde ÚNICAMENTE con JSON válido con esta forma:",
    '{ "summary": "resumen breve del plan", "items": [',
    '  { "id": "item_1", "title": "título corto", "description": "qué se hará y por qué", "kind": "analysis|creation|external_action", "capability": "qué capacidad/efecto necesita" }',
    "] }",
    "",
    "Reglas de clasificación:",
    "- analysis: análisis, investigación o planificación interna SIN efectos externos (no requiere aprobación).",
    "- creation: creación de contenido/entregable interno (borrador de copy, guía, calendario) SIN publicar (no requiere aprobación).",
    "- external_action: publicar, enviar, gastar dinero, lanzar campaña o tocar sistemas externos (SÍ requiere aprobación del CEO).",
    "Prioriza 3-5 items. El primer item debe ser accionable de inmediato por Marketing.",
    "",
    "CONTEXTO REAL DEL NEGOCIO:",
    context,
  ].join("\n");
}

function buildExecuteSystemPrompt(context: string): string {
  return [
    "Eres el Director del Departamento de Marketing de esta empresa.",
    "Produce el entregable FINAL y concreto para el elemento de trabajo indicado.",
    "Usa ÚNICAMENTE el contexto real del negocio. No inventes datos de la empresa.",
    "El entregable debe ser accionable, específico para esta empresa y listo para que el CEO lo revise.",
    "Si el trabajo requiere una capacidad que NO está disponible, dilo explícitamente en lugar de simularla.",
    "",
    "CONTEXTO REAL DEL NEGOCIO:",
    context,
  ].join("\n");
}

/**
 * Tolerant JSON parse: strips fences / leading text and extracts the first
 * JSON object, mirroring the pattern already used by web analysis.
 */
function parsePlanJson(text: string): { summary?: string; items?: MarketingWorkItem[] } | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.items)) {
      return null;
    }
    const items: MarketingWorkItem[] = (candidate.items as unknown[])
      .filter((item) => typeof item === "object" && item !== null)
      .map((item, index) => {
        const it = item as Record<string, unknown>;
        const kindValue = it.kind;
        const kind: MarketingWorkItem["kind"] =
          kindValue === "external_action" || kindValue === "creation" || kindValue === "analysis"
            ? kindValue
            : "analysis";
        return {
          id: typeof it.id === "string" ? it.id : `item_${index + 1}`,
          title: typeof it.title === "string" ? it.title : "Trabajo de Marketing",
          description: typeof it.description === "string" ? it.description : "",
          kind,
          ...(typeof it.capability === "string"
            ? { capability: it.capability }
            : {}),
        };
      });
    return {
      summary: typeof candidate.summary === "string" ? candidate.summary : "",
      items,
    };
  } catch {
    return null;
  }
}
