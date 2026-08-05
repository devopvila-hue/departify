import type {
  AgentToolAction,
  AgentToolPort,
} from "@departify/agent-tool-bridge";
import type {
  AssignTaskIntent,
  ExecutiveDecision,
} from "@departify/executive-director";
import type {
  OrchestratorIntent,
  OrchestratorIntentSummary,
  OrchestratorToolMapping,
} from "../contracts/orchestrator-contracts.js";
import { orchestratorToolMappings } from "../contracts/orchestrator-contracts.js";

/**
 * DecisionMapper — the only component authorised to translate an
 * `ExecutiveDecision` into an `AgentToolAction`.
 *
 * Pure mapping. No I/O. No business logic. The mapper relies on the
 * orchestrator's static table (orchestratorToolMappings) to decide which
 * Tool each OrchestratorIntent triggers.
 */
export class ExecutiveDecisionMapper {
  private readonly mappings: Readonly<Record<string, OrchestratorToolMapping>>;

  constructor(
    mappings: Readonly<
      Record<string, OrchestratorToolMapping>
    > = orchestratorToolMappings,
  ) {
    this.mappings = mappings;
  }

  /**
   * Adapts an OrchestratorIntent into the Executive Intent shape that
   * Executive Director already understands. Sprint 23 routes every intent
   * through `assign_task`, which is the only Executive Intent that carries
   * a flexible `payload` slot suited to tool-catalog dispatch.
   *
   * The org id used by the synthetic intent is taken from the caller when
   * present; otherwise a sentinel value is used because the Executive
   * Intent validation requires it. The synthetic intent always carries a
   * `targetAgentId` so the Executive Director validation passes.
   */
  toExecutiveIntent(
    intent: OrchestratorIntent,
    agentId = "agent.executive",
  ): AssignTaskIntent {
    const mapping = this.requireMapping(intent);
    const baseMetadata = intent.metadata ?? {};
    const organizationId =
      "organizationId" in intent && intent.organizationId
        ? intent.organizationId
        : "org_default";

    return {
      type: "assign_task",
      intentId: intent.intentId,
      requestedBy: intent.requestedBy,
      organizationId,
      taskId: `tool:${mapping.toolId}`,
      title: `Execute ${mapping.toolId}`,
      targetAgentId: agentId,
      occurredAt: new Date(),
      metadata: {
        ...baseMetadata,
        orchestrator_intent: intent.type,
        orchestrator_tool: mapping.toolId,
      },
    };
  }

  /**
   * Translates an ExecutiveDecision into the AgentToolAction consumed by the
   * AgentToolBridge. The mapper looks up the originating OrchestratorIntent
   * through the intent metadata so it can resolve the Tool and args
   * deterministically.
   */
  toAgentToolAction(
    decision: ExecutiveDecision,
    intent: OrchestratorIntentSummary,
    agentId: string,
  ): AgentToolAction {
    const mapping = this.requireMapping(intent);
    const actionId = `act_${decision.decisionId}`;
    const action: AgentToolAction = {
      actionId,
      agentId,
      ...(intent.organizationId
        ? { organizationId: intent.organizationId }
        : {}),
      toolId: mapping.toolId,
      args: { ...mapping.toolArgs },
      metadata: {
        intent_id: intent.intentId,
        decision_id: decision.decisionId,
        action_id: actionId,
        orchestrator_intent: intent.type,
      },
    };
    return Object.freeze(action);
  }

  /**
   * Convenience entry point: returns the Tool id that an OrchestratorIntent
   * triggers.
   */
  resolveToolId(intent: OrchestratorIntentSummary): string {
    return this.requireMapping(intent).toolId;
  }

  private requireMapping(
    intent: OrchestratorIntentSummary,
  ): OrchestratorToolMapping {
    const mapping = this.mappings[intent.type];
    if (!mapping) {
      throw new Error(
        `No tool mapping registered for orchestrator intent '${intent.type}'.`,
      );
    }
    return mapping;
  }
}

/**
 * Convenience factory that wires the default intent → tool mapping.
 */
export function createExecutiveDecisionMapper(): ExecutiveDecisionMapper {
  return new ExecutiveDecisionMapper(orchestratorToolMappings);
}

/**
 * Re-export of the AgentToolPort type so consumers do not need to import
 * from `@departify/agent-tool-bridge` directly to type their composition.
 */
export type { AgentToolPort };
