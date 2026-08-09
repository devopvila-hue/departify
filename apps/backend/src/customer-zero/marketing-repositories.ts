/**
 * Durable Marketing state — Departify-owned repository contracts (DEPLOY 01).
 *
 * These are the ports the MarketingService depends on. The business logic does
 * not know about Supabase. Implementations: Supabase (production), in-memory
 * (tests/dev).
 */

import type {
  ApprovalRequest,
  BusinessObjective,
  DepartmentActivity,
} from "./marketing-domain.js";

export interface MarketingObjectiveRepository {
  create(input: {
    organizationId: string;
    departmentId: "marketing";
    title: string;
    description: string;
    desiredOutcome: string;
    constraints: readonly string[];
    owner: string;
    createdBy: "ceo";
  }): Promise<BusinessObjective>;

  findActive(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<BusinessObjective | null>;

  list(organizationId: string, departmentId: "marketing"): Promise<BusinessObjective[]>;

  get(
    organizationId: string,
    objectiveId: string,
  ): Promise<BusinessObjective | null>;

  addConstraint(
    organizationId: string,
    objectiveId: string,
    constraint: string,
  ): Promise<BusinessObjective | null>;

  updateProgress(
    organizationId: string,
    objectiveId: string,
    progress: number,
  ): Promise<BusinessObjective | null>;
}

export interface MarketingActivityRepository {
  create(input: {
    organizationId: string;
    departmentId: "marketing";
    objectiveId?: string;
    actor: string;
    type: DepartmentActivity["kind"];
    message: string;
  }): Promise<DepartmentActivity>;

  listRecent(
    organizationId: string,
    departmentId: "marketing",
    limit?: number,
  ): Promise<DepartmentActivity[]>;
}

export interface MarketingApprovalRepository {
  create(input: {
    organizationId: string;
    departmentId: "marketing";
    objectiveId?: string;
    title: string;
    description: string;
    status: "pending";
    cost?: string;
    requestedBy: string;
  }): Promise<ApprovalRequest>;

  list(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<ApprovalRequest[]>;

  decide(
    organizationId: string,
    approvalId: string,
    decision: "approve" | "reject",
    decidedBy: string,
  ): Promise<ApprovalRequest | null>;
}
