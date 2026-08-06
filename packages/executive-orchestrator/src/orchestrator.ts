import type { AgentToolPort } from "@departify/agent-tool-bridge";
import type {
  ExecutiveDirector,
  ExecutiveDirectorResult,
} from "@departify/executive-director";
import type {
  DiscoveryAnalyzeIntent,
  HealthCheckIntent,
  OrganizationSummaryIntent,
  GenerateIdentifierIntent,
  OrchestratorIntent,
  OrchestratorIntentSummary,
} from "./contracts/orchestrator-contracts.js";
import {
  fromAgentToolOutcome,
  type OrchestrationResult,
} from "./contracts/orchestration-result.js";
import {
  ExecutiveDecisionMapper,
  createExecutiveDecisionMapper,
} from "./decisions/executive-decision-mapper.js";

/**
 * Default agent id assigned to orchestrated Tool invocations when the
 * orchestrator intent does not specify one. Sprint 23 keeps this single
 * because the runtime layer is intentionally one-shot per intent.
 */
const DEFAULT_AGENT_ID = "agent.executive";

/**
 * Main orchestrator. Wires Executive Director into the AgentToolBridge.
 *
 * Pipeline (deterministic, no IA):
 *
 *   OrchestratorIntent
 *     → ExecutiveDecisionMapper.toExecutiveIntent (synthetic assign_task)
 *     → ExecutiveDirector.evaluate (existing public API)
 *     → ExecutiveDecision
 *     → ExecutiveDecisionMapper.toAgentToolAction
 *     → AgentToolPort.executeAction
 *     → AgentToolBridge / Tool Runtime / Core Tool Catalog
 *     → OrchestrationResult (preserving intent/decision/action correlation)
 */
export class ExecutiveOrchestrator {
  private readonly director: ExecutiveDirector;
  private readonly mapper: ExecutiveDecisionMapper;
  private readonly bridge: AgentToolPort;

  constructor(options: {
    director: ExecutiveDirector;
    bridge: AgentToolPort;
    mapper?: ExecutiveDecisionMapper;
  }) {
    this.director = options.director;
    this.bridge = options.bridge;
    this.mapper = options.mapper ?? createExecutiveDecisionMapper();
  }

  async orchestrateHealthCheck(
    intent: HealthCheckIntent,
  ): Promise<OrchestrationResult> {
    return this.orchestrate(intent);
  }

  async orchestrateOrganizationSummary(
    intent: OrganizationSummaryIntent,
  ): Promise<OrchestrationResult> {
    return this.orchestrate(intent);
  }

  async orchestrateGenerateIdentifier(
    intent: GenerateIdentifierIntent,
  ): Promise<OrchestrationResult> {
    return this.orchestrate(intent);
  }

  async orchestrateDiscoveryAnalyze(
    intent: DiscoveryAnalyzeIntent,
  ): Promise<OrchestrationResult> {
    return this.orchestrate(intent);
  }

  /**
   * Generic entry point. Dispatches any supported OrchestratorIntent through
   * the full pipeline. Returns a single typed envelope regardless of outcome.
   */
  async orchestrate(intent: OrchestratorIntent): Promise<OrchestrationResult> {
    const startedAt = new Date().toISOString();

    // 1. Adapt to the Executive Intent Executive Director understands.
    const executiveIntent = this.mapper.toExecutiveIntent(intent);

    // 2. Evaluate deterministically through Executive Director.
    let directorResult: ExecutiveDirectorResult;
    try {
      directorResult = this.director.evaluate(executiveIntent);
    } catch (cause) {
      return this.buildRejection(
        intent,
        null,
        "decision",
        cause instanceof Error ? cause.message : String(cause),
        "evaluation_failed",
        startedAt,
      );
    }

    // 3. Honor rejections immediately — no Tool dispatch.
    if (directorResult.outcome.decision.type === "reject_intent") {
      return this.buildRejection(
        intent,
        directorResult.outcome.decision,
        "decision",
        directorResult.outcome.decision.rationale,
        "intent_rejected",
        startedAt,
      );
    }

    // 4. Translate the decision into an AgentToolAction.
    const decision = directorResult.outcome.decision;
    const agentId = intent.agentId ?? DEFAULT_AGENT_ID;
    const action = this.mapper.toAgentToolAction(decision, intent, agentId);

    // 5. Dispatch through the AgentToolBridge.
    let outcome;
    try {
      outcome = await this.bridge.executeAction(action);
    } catch (cause) {
      return this.buildRejection(
        intent,
        decision,
        "bridge",
        cause instanceof Error ? cause.message : String(cause),
        "bridge_failed",
        startedAt,
      );
    }

    const completedAt = new Date().toISOString();
    return fromAgentToolOutcome(
      intent,
      decision,
      outcome,
      startedAt,
      completedAt,
    );
  }

  private buildRejection(
    intent: OrchestratorIntentSummary,
    decision: ExecutiveDirectorResult["outcome"]["decision"] | null,
    phase: "intent" | "decision" | "bridge" | "tool",
    message: string,
    code: string,
    startedAt: string,
  ): OrchestrationResult {
    return {
      intentId: intent.intentId,
      decisionId: decision?.decisionId ?? null,
      actionId: decision ? `act_${decision.decisionId}` : null,
      decision,
      intent,
      tool: {
        toolId: this.mapper.resolveToolId(intent),
        status: "rejected",
      },
      output: null,
      error: { code, message, phase },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}

export interface CreateOrchestratorOptions {
  director: ExecutiveDirector;
  bridge: AgentToolPort;
  mapper?: ExecutiveDecisionMapper;
}

export function createExecutiveOrchestrator(
  options: CreateOrchestratorOptions,
): ExecutiveOrchestrator {
  return new ExecutiveOrchestrator(options);
}
