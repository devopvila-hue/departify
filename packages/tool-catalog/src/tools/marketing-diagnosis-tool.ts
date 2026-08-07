import type { DiscoveryReportRepository } from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolDefinition,
} from "@departify/tool-runtime";
import {
  produceMarketingDiagnosis,
  type MarketingDiagnosis,
  type MarketingDiagnosisInput,
} from "@departify/marketing-director";

export type { MarketingDiagnosis, MarketingDiagnosisInput };

export function createMarketingDiagnosisToolDefinition(
  repository: DiscoveryReportRepository,
): ToolDefinition<MarketingDiagnosisInput, MarketingDiagnosis> {
  return {
    id: "marketing.diagnosis",
    version: "1.0.0",
    metadata: {
      displayName: "Marketing Diagnosis",
      description:
        "Analiza el negocio del CEO y produce un diagnóstico de Marketing estructurado, específico para esta empresa.",
      tags: ["marketing", "diagnosis", "business"],
    },
    capabilities: ["deterministic", "idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: [
        "companyName",
        "goal",
        "locale",
        "hasWebsite",
        "connectedTools",
        "declaredTools",
        "unmappedTools",
        "discoveryGaps",
      ],
      properties: {
        companyName: { type: "string", minLength: 1 },
        goal: { type: "string", minLength: 1 },
        locale: { type: "string" },
        country: { type: "string" },
        companySize: { type: "string" },
        hasWebsite: { type: "boolean" },
        description: { type: "string" },
        products: { type: "array" },
        services: { type: "array" },
        targetAudience: { type: "string" },
        positioning: { type: "string" },
        connectedTools: { type: "array" },
        declaredTools: { type: "array" },
        unmappedTools: { type: "array" },
        discoveryGaps: { type: "array" },
      },
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      required: [
        "companyName",
        "goal",
        "locale",
        "whatTheCeoWants",
        "whereTheyAreNow",
        "whatSeemsMissing",
        "opportunities",
        "neededCapabilities",
        "neededSpecialistRoles",
        "whatCanBeDoneNow",
        "whatIsBlocked",
        "whatToDoFirst",
        "whatNotWorthDoingYet",
        "generatedAt",
      ],
    },
    limits: { timeoutMs: 2_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: MarketingDiagnosisInput,
    ): Promise<MarketingDiagnosis> => {
      const records = repository.findByOrganizationId(
        (args as unknown as Record<string, unknown>).organizationId as string ?? "unknown",
      );
      const mostRecent = records.length > 0 ? records[records.length - 1] : null;
      const report = mostRecent?.report ?? null;

      return produceMarketingDiagnosis(args, report);
    },
  };
}
