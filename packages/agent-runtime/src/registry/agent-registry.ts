import type {
  AgentDefinition,
  AgentId,
  AgentRuntimeRecord,
  AgentRuntimeStatus,
} from "../contracts/agent-contracts.js";
import type { AgentRuntimeDomainEvent } from "../events/agent-runtime-events.js";
import { AgentLifecyclePolicy } from "../state/agent-lifecycle.js";
import {
  AgentRuntimeValidationError,
  assertRuntimeValid,
} from "../validation/runtime-error.js";

export class AgentRegistry {
  private readonly records = new Map<AgentId, AgentRuntimeRecord>();
  private readonly events: AgentRuntimeDomainEvent[] = [];
  private readonly lifecycle = new AgentLifecyclePolicy();

  register(
    definition: AgentDefinition,
    occurredAt = new Date(),
  ): AgentRuntimeRecord {
    validateAgentDefinition(definition);
    if (this.records.has(definition.id)) {
      throw new AgentRuntimeValidationError("Agent already exists.");
    }

    const record: AgentRuntimeRecord = {
      definition: { ...definition },
      status: "registered",
      revision: 1,
    };
    this.records.set(definition.id, record);
    this.events.push({
      type: "agent.registered",
      agentId: definition.id,
      organizationId: definition.organizationId,
      occurredAt,
    });
    return cloneRecord(record);
  }

  activate(agentId: AgentId, occurredAt = new Date()): AgentRuntimeRecord {
    const record = this.transition(agentId, "starting");
    this.events.push({
      type: "agent.started",
      agentId,
      occurredAt,
    });
    return record;
  }

  markReady(agentId: AgentId, occurredAt = new Date()): AgentRuntimeRecord {
    const record = this.transition(agentId, "ready");
    this.events.push({
      type: "agent.ready",
      agentId,
      occurredAt,
    });
    return record;
  }

  pause(agentId: AgentId, occurredAt = new Date()): AgentRuntimeRecord {
    const record = this.transition(agentId, "paused");
    this.events.push({
      type: "agent.paused",
      agentId,
      occurredAt,
    });
    return record;
  }

  deactivate(agentId: AgentId, occurredAt = new Date()): AgentRuntimeRecord {
    const current = this.requireRecord(agentId);
    const record =
      current.status === "registered" || current.status === "failed"
        ? this.transition(agentId, "stopped")
        : this.stopAgent(agentId);
    this.events.push({
      type: "agent.stopped",
      agentId,
      occurredAt,
    });
    return record;
  }

  fail(
    agentId: AgentId,
    reason: string,
    occurredAt = new Date(),
  ): AgentRuntimeRecord {
    const current = this.requireRecord(agentId);
    const normalizedReason = reason.trim();
    assertRuntimeValid(
      normalizedReason.length >= 3,
      "Agent failure reason must contain at least 3 characters.",
    );
    const record = this.transition(agentId, "failed");
    this.events.push({
      type: "agent.failed",
      agentId,
      previousStatus: current.status,
      reason: normalizedReason,
      occurredAt,
    });
    return record;
  }

  get(agentId: AgentId): AgentRuntimeRecord | null {
    const record = this.records.get(agentId);
    return record ? cloneRecord(record) : null;
  }

  list(): readonly AgentRuntimeRecord[] {
    return [...this.records.values()].map((record) => cloneRecord(record));
  }

  remove(agentId: AgentId, occurredAt = new Date()): void {
    const record = this.requireRecord(agentId);
    if (record.status !== "stopped") {
      this.deactivate(agentId, occurredAt);
    }
    this.records.delete(agentId);
    this.events.push({
      type: "agent.removed",
      agentId,
      occurredAt,
    });
  }

  pullEvents(): readonly AgentRuntimeDomainEvent[] {
    const pulled = [...this.events];
    this.events.length = 0;
    return pulled;
  }

  private transition(
    agentId: AgentId,
    nextStatus: AgentRuntimeStatus,
  ): AgentRuntimeRecord {
    const record = this.requireRecord(agentId);
    this.lifecycle.assertTransition(record.status, nextStatus);
    const nextRecord: AgentRuntimeRecord = {
      definition: record.definition,
      status: nextStatus,
      revision: record.revision + 1,
    };
    this.records.set(agentId, nextRecord);
    return cloneRecord(nextRecord);
  }

  private stopAgent(agentId: AgentId): AgentRuntimeRecord {
    this.transition(agentId, "stopping");
    return this.transition(agentId, "stopped");
  }

  private requireRecord(agentId: AgentId): AgentRuntimeRecord {
    const record = this.records.get(agentId);
    if (!record) {
      throw new AgentRuntimeValidationError("Agent does not exist.");
    }
    return record;
  }
}

function validateAgentDefinition(definition: AgentDefinition): void {
  assertRuntimeValid(definition.id.trim().length > 0, "Agent id is required.");
  assertRuntimeValid(
    definition.organizationId.trim().length > 0,
    "Agent organizationId is required.",
  );
  assertRuntimeValid(
    definition.displayName.trim().length >= 2,
    "Agent displayName must contain at least 2 characters.",
  );
  assertRuntimeValid(
    definition.role.trim().length > 0,
    "Agent role is required.",
  );
}

function cloneRecord(record: AgentRuntimeRecord): AgentRuntimeRecord {
  return {
    definition: { ...record.definition },
    status: record.status,
    revision: record.revision,
  };
}
