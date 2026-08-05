import type { AgentDomainEvent } from "../events/agent-events.js";
import {
  AgentLifecyclePolicy,
  agentStatuses,
  type AgentStatus,
} from "../services/agent-lifecycle-policy.js";
import { assertAgentDomainInvariant } from "../validation/domain-error.js";
import {
  AgentCapabilities,
  type AgentCapabilitiesSnapshot,
} from "../value-objects/agent-capabilities.js";
import { AgentId } from "../value-objects/agent-id.js";
import { AgentName } from "../value-objects/agent-name.js";
import {
  AgentPermissions,
  type AgentPermissionsSnapshot,
} from "../value-objects/agent-permissions.js";
import {
  AgentProfile,
  type AgentProfileSnapshot,
} from "../value-objects/agent-profile.js";
import { AgentRole } from "../value-objects/agent-role.js";
import { DepartmentId } from "../value-objects/department-id.js";

export interface AgentSnapshot {
  id: string;
  name: string;
  role: string;
  departmentId: string;
  capabilities: AgentCapabilitiesSnapshot;
  permissions: AgentPermissionsSnapshot;
  profile: AgentProfileSnapshot;
  status: AgentStatus;
}

export interface CreateAgentInput {
  id: string;
  name: string;
  role: string;
  departmentId: string;
  capabilities: AgentCapabilitiesSnapshot;
  permissions: AgentPermissionsSnapshot;
  profile: AgentProfileSnapshot;
  occurredAt?: Date;
}

export class Agent {
  private readonly lifecyclePolicy = new AgentLifecyclePolicy();
  private readonly domainEvents: AgentDomainEvent[] = [];

  private constructor(
    private readonly id: AgentId,
    private name: AgentName,
    private role: AgentRole,
    private departmentId: DepartmentId,
    private capabilities: AgentCapabilities,
    private permissions: AgentPermissions,
    private profile: AgentProfile,
    private status: AgentStatus,
  ) {}

  static create(input: CreateAgentInput): Agent {
    const agent = new Agent(
      AgentId.create(input.id),
      AgentName.create(input.name),
      AgentRole.create(input.role),
      DepartmentId.create(input.departmentId),
      AgentCapabilities.create(input.capabilities),
      AgentPermissions.create(input.permissions),
      AgentProfile.create(input.profile),
      "created",
    );

    agent.record({
      type: "agent.created",
      agentId: agent.id.toString(),
      agentName: agent.name.toString(),
      departmentId: agent.departmentId.toString(),
      occurredAt: input.occurredAt ?? new Date(),
    });

    return agent;
  }

  static reconstitute(snapshot: AgentSnapshot): Agent {
    assertAgentDomainInvariant(
      agentStatuses.includes(snapshot.status),
      "Agent status is invalid.",
    );
    return new Agent(
      AgentId.create(snapshot.id),
      AgentName.create(snapshot.name),
      AgentRole.create(snapshot.role),
      DepartmentId.create(snapshot.departmentId),
      AgentCapabilities.create(snapshot.capabilities),
      AgentPermissions.create(snapshot.permissions),
      AgentProfile.create(snapshot.profile),
      snapshot.status,
    );
  }

  getId(): AgentId {
    return this.id;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  activate(occurredAt = new Date()): void {
    this.transitionTo("active");
    this.record({
      type: "agent.activated",
      agentId: this.id.toString(),
      occurredAt,
    });
  }

  pause(occurredAt = new Date()): void {
    this.transitionTo("paused");
    this.record({
      type: "agent.paused",
      agentId: this.id.toString(),
      occurredAt,
    });
  }

  resume(occurredAt = new Date()): void {
    this.transitionTo("active");
    this.record({
      type: "agent.resumed",
      agentId: this.id.toString(),
      occurredAt,
    });
  }

  disable(reason: string, occurredAt = new Date()): void {
    const normalizedReason = normalizeReason(reason);
    this.transitionTo("disabled");
    this.record({
      type: "agent.disabled",
      agentId: this.id.toString(),
      reason: normalizedReason,
      occurredAt,
    });
  }

  delete(reason: string, occurredAt = new Date()): void {
    const normalizedReason = normalizeReason(reason);
    this.transitionTo("deleted");
    this.record({
      type: "agent.deleted",
      agentId: this.id.toString(),
      reason: normalizedReason,
      occurredAt,
    });
  }

  rename(name: string): void {
    this.assertMutable();
    this.name = AgentName.create(name);
  }

  changeRole(role: string): void {
    this.assertMutable();
    this.role = AgentRole.create(role);
  }

  moveToDepartment(departmentId: string): void {
    this.assertMutable();
    this.departmentId = DepartmentId.create(departmentId);
  }

  replaceCapabilities(capabilities: AgentCapabilitiesSnapshot): void {
    this.assertMutable();
    this.capabilities = AgentCapabilities.create(capabilities);
  }

  replacePermissions(permissions: AgentPermissionsSnapshot): void {
    this.assertMutable();
    this.permissions = AgentPermissions.create(permissions);
  }

  updateProfile(profile: AgentProfileSnapshot): void {
    this.assertMutable();
    this.profile = AgentProfile.create(profile);
  }

  pullDomainEvents(): readonly AgentDomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
  }

  toSnapshot(): AgentSnapshot {
    return {
      id: this.id.toString(),
      name: this.name.toString(),
      role: this.role.toString(),
      departmentId: this.departmentId.toString(),
      capabilities: this.capabilities.toSnapshot(),
      permissions: this.permissions.toSnapshot(),
      profile: this.profile.toSnapshot(),
      status: this.status,
    };
  }

  private transitionTo(nextStatus: AgentStatus): void {
    this.lifecyclePolicy.assertTransition(this.status, nextStatus);
    this.status = nextStatus;
  }

  private assertMutable(): void {
    assertAgentDomainInvariant(
      this.status !== "deleted",
      "Deleted agents cannot be modified.",
    );
  }

  private record(event: AgentDomainEvent): void {
    this.domainEvents.push(event);
  }
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
  assertAgentDomainInvariant(
    normalized.length >= 3 && normalized.length <= 240,
    "Lifecycle transition reason must be between 3 and 240 characters.",
  );
  return normalized;
}
