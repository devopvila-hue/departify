import type { KnowledgeStatus } from "../knowledge/knowledge-types.js";
import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export const allowedKnowledgeTransitions: Record<
  KnowledgeStatus,
  readonly KnowledgeStatus[]
> = {
  draft: ["active", "archived", "deleted"],
  active: ["indexed", "archived", "deleted"],
  indexed: ["active", "archived", "deleted"],
  archived: ["active", "deleted"],
  deleted: [],
};

export const terminalKnowledgeStatuses = ["deleted"] as const;

export class KnowledgeLifecyclePolicy {
  canTransition(from: KnowledgeStatus, to: KnowledgeStatus): boolean {
    return allowedKnowledgeTransitions[from].includes(to);
  }

  assertTransition(from: KnowledgeStatus, to: KnowledgeStatus): void {
    assertKnowledgeValid(
      this.canTransition(from, to),
      `Knowledge cannot transition from ${from} to ${to}.`,
    );
  }
}
