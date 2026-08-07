import type {
  ToolExecutionContext,
  ToolDefinition,
} from "@departify/tool-runtime";
import {
  formTeam,
  type TeamFormationResult,
} from "@departify/marketing-director";

export interface MarketingFormTeamInput {
  readonly goal: string;
  readonly specialistRoles: readonly string[];
  readonly locale: string;
  readonly connectedTools: readonly string[];
}

export type { TeamFormationResult };

export function createMarketingFormTeamToolDefinition(): ToolDefinition<
  MarketingFormTeamInput,
  TeamFormationResult
> {
  return {
    id: "marketing.form_team",
    version: "1.0.0",
    metadata: {
      displayName: "Marketing Form Team",
      description:
        "Forma dinámicamente el equipo de Marketing según el objetivo del CEO y las capacidades necesarias.",
      tags: ["marketing", "team", "business"],
    },
    capabilities: ["deterministic", "idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["goal", "specialistRoles", "locale", "connectedTools"],
      properties: {
        goal: { type: "string", minLength: 1 },
        specialistRoles: { type: "array" },
        locale: { type: "string" },
        connectedTools: { type: "array" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["director", "specialists", "message", "locale"],
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: MarketingFormTeamInput,
    ): Promise<TeamFormationResult> => {
      return formTeam(
        args.goal,
        args.specialistRoles,
        args.locale,
        args.connectedTools,
      );
    },
  };
}
