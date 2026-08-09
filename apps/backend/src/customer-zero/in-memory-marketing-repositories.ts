/**
 * In-memory implementations of the durable Marketing repositories — for tests
 * and local dev only. Production uses the Supabase implementations.
 *
 * They DO isolate by organization (like the durable ones): each org's rows are
 * kept separately so multi-company tests remain valid.
 */

import { randomUUID } from "node:crypto";
import type {
  MarketingActivityRepository,
  MarketingApprovalRepository,
  MarketingObjectiveRepository,
} from "./marketing-repositories.js";
import type {
  ApprovalRequest,
  BusinessObjective,
  DepartmentActivity,
} from "./marketing-domain.js";

export class InMemoryMarketingObjectiveRepository
  implements MarketingObjectiveRepository
{
  private readonly byOrg = new Map<string, BusinessObjective[]>();

  private rows(organizationId: string): BusinessObjective[] {
    let list = this.byOrg.get(organizationId);
    if (!list) {
      list = [];
      this.byOrg.set(organizationId, list);
    }
    return list;
  }

  async create(input: {
    organizationId: string;
    departmentId: "marketing";
    title: string;
    description: string;
    desiredOutcome: string;
    constraints: readonly string[];
    owner: string;
    createdBy: "ceo";
  }): Promise<BusinessObjective> {
    const objective: BusinessObjective = {
      id: `obj_${randomUUID().slice(0, 8)}`,
      departmentId: input.departmentId,
      title: input.title,
      description: input.description,
      desiredOutcome: input.desiredOutcome,
      constraints: [...input.constraints],
      status: "active",
      progress: 0,
      owner: input.owner,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    this.rows(input.organizationId).push(objective);
    return objective;
  }

  async findActive(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<BusinessObjective | null> {
    return (
      this.rows(organizationId).find(
        (o) => o.status === "active" && o.departmentId === departmentId,
      ) ?? null
    );
  }

  async list(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<BusinessObjective[]> {
    return this.rows(organizationId).filter(
      (o) => o.departmentId === departmentId,
    );
  }

  async get(
    organizationId: string,
    objectiveId: string,
  ): Promise<BusinessObjective | null> {
    return this.rows(organizationId).find((o) => o.id === objectiveId) ?? null;
  }

  async addConstraint(
    organizationId: string,
    objectiveId: string,
    constraint: string,
  ): Promise<BusinessObjective | null> {
    const list = this.rows(organizationId);
    const index = list.findIndex((o) => o.id === objectiveId);
    if (index < 0) return null;
    const current = list[index]!;
    const updated: BusinessObjective = {
      ...current,
      constraints: [...current.constraints, constraint],
    };
    list[index] = updated;
    return updated;
  }

  async updateProgress(
    organizationId: string,
    objectiveId: string,
    progress: number,
  ): Promise<BusinessObjective | null> {
    const list = this.rows(organizationId);
    const index = list.findIndex((o) => o.id === objectiveId);
    if (index < 0) return null;
    const updated: BusinessObjective = {
      ...list[index]!,
      progress: Math.max(0, Math.min(100, progress)),
    };
    list[index] = updated;
    return updated;
  }
}

export class InMemoryMarketingActivityRepository
  implements MarketingActivityRepository
{
  private readonly byOrg = new Map<string, DepartmentActivity[]>();

  private rows(organizationId: string): DepartmentActivity[] {
    let list = this.byOrg.get(organizationId);
    if (!list) {
      list = [];
      this.byOrg.set(organizationId, list);
    }
    return list;
  }

  async create(input: {
    organizationId: string;
    departmentId: "marketing";
    objectiveId?: string;
    actor: string;
    type: DepartmentActivity["kind"];
    message: string;
  }): Promise<DepartmentActivity> {
    const entry: DepartmentActivity = {
      id: `act_${randomUUID().slice(0, 8)}`,
      departmentId: input.departmentId,
      actor: input.actor,
      kind: input.type,
      message: input.message,
      createdAt: new Date().toISOString(),
      ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
    };
    this.rows(input.organizationId).unshift(entry);
    return entry;
  }

  async listRecent(
    organizationId: string,
    _departmentId: "marketing",
    limit = 20,
  ): Promise<DepartmentActivity[]> {
    return this.rows(organizationId).slice(0, limit);
  }
}

export class InMemoryMarketingApprovalRepository
  implements MarketingApprovalRepository
{
  private readonly byOrg = new Map<string, ApprovalRequest[]>();

  private rows(organizationId: string): ApprovalRequest[] {
    let list = this.byOrg.get(organizationId);
    if (!list) {
      list = [];
      this.byOrg.set(organizationId, list);
    }
    return list;
  }

  async create(input: {
    organizationId: string;
    departmentId: "marketing";
    objectiveId?: string;
    title: string;
    description: string;
    status: "pending";
    cost?: string;
    requestedBy: string;
  }): Promise<ApprovalRequest> {
    const entry: ApprovalRequest = {
      id: `appr_${randomUUID().slice(0, 8)}`,
      departmentId: input.departmentId,
      from: input.requestedBy,
      title: input.title,
      detail: input.description,
      ...(input.cost ? { cost: input.cost } : {}),
      status: input.status,
      createdAt: new Date().toISOString(),
    };
    this.rows(input.organizationId).unshift(entry);
    return entry;
  }

  async list(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<ApprovalRequest[]> {
    void departmentId;
    return [...this.rows(organizationId)];
  }

  async decide(
    organizationId: string,
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<ApprovalRequest | null> {
    const list = this.rows(organizationId);
    const index = list.findIndex((a) => a.id === approvalId);
    if (index < 0) return null;
    if (list[index]!.status !== "pending") return null;
    const updated: ApprovalRequest = {
      ...list[index]!,
      status: decision === "approve" ? "approved" : "rejected",
      decidedAt: new Date().toISOString(),
    };
    list[index] = updated;
    return updated;
  }
}
