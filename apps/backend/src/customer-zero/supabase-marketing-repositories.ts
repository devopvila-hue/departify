/**
 * Supabase implementations of the durable Marketing repositories (DEPLOY 01).
 *
 * Org-scoped by construction: every query filters by organization_id. Uses the
 * service role (bypasses RLS; RLS remains defense-in-depth for authenticated
 * reads). Follows the existing SupabaseConversationStore pattern.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
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

const DEPT = "marketing";

interface ObjectiveRow {
  id: string;
  organization_id: string;
  department_id: string;
  title: string;
  description: string;
  desired_outcome: string;
  constraints: string[] | string;
  status: BusinessObjective["status"];
  progress: number;
  owner: string;
  created_by: string;
  plan: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  organization_id: string;
  department_id: string;
  objective_id: string | null;
  actor: string;
  type: DepartmentActivity["kind"];
  message: string;
  metadata: unknown;
  created_at: string;
}

interface ApprovalRow {
  id: string;
  organization_id: string;
  department_id: string;
  objective_id: string | null;
  title: string;
  description: string;
  status: ApprovalRequest["status"];
  cost: string | null;
  requested_by: string;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

function mapObjective(row: ObjectiveRow): BusinessObjective {
  const constraints = Array.isArray(row.constraints)
    ? row.constraints
    : (typeof row.constraints === "string" && row.constraints.length > 0
        ? (JSON.parse(row.constraints) as string[])
        : []);
  return {
    id: row.id,
    departmentId: row.department_id as "marketing",
    title: row.title,
    description: row.description,
    desiredOutcome: row.desired_outcome,
    constraints,
    status: row.status,
    progress: row.progress,
    owner: row.owner,
    createdBy: "ceo",
    createdAt: row.created_at,
    ...(row.plan ? { plan: row.plan } : {}),
  };
}

function mapActivity(row: ActivityRow): DepartmentActivity {
  return {
    id: row.id,
    departmentId: row.department_id as "marketing",
    actor: row.actor,
    kind: row.type,
    message: row.message,
    createdAt: row.created_at,
    ...(row.objective_id ? { objectiveId: row.objective_id } : {}),
  };
}

function mapApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    departmentId: row.department_id as "marketing",
    from: row.requested_by,
    title: row.title,
    detail: row.description,
    ...(row.cost ? { cost: row.cost } : {}),
    status: row.status,
    createdAt: row.created_at,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
  };
}

export class SupabaseMarketingObjectiveRepository
  implements MarketingObjectiveRepository
{
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
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
    const { data, error } = await this.admin
      .from("marketing_objectives")
      .insert({
        organization_id: input.organizationId,
        department_id: DEPT,
        title: input.title,
        description: input.description,
        desired_outcome: input.desiredOutcome,
        constraints: JSON.stringify([...input.constraints]),
        status: "active",
        progress: 0,
        owner: input.owner,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return mapObjective(data as ObjectiveRow);
  }

  async findActive(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<BusinessObjective | null> {
    const { data, error } = await this.admin
      .from("marketing_objectives")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("department_id", departmentId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapObjective(data as ObjectiveRow) : null;
  }

  async list(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<BusinessObjective[]> {
    const { data, error } = await this.admin
      .from("marketing_objectives")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("department_id", departmentId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => mapObjective(r as ObjectiveRow));
  }

  async get(
    organizationId: string,
    objectiveId: string,
  ): Promise<BusinessObjective | null> {
    const { data, error } = await this.admin
      .from("marketing_objectives")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", objectiveId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapObjective(data as ObjectiveRow) : null;
  }

  async addConstraint(
    organizationId: string,
    objectiveId: string,
    constraint: string,
  ): Promise<BusinessObjective | null> {
    const current = await this.get(organizationId, objectiveId);
    if (!current) return null;
    const updated = await this.admin
      .from("marketing_objectives")
      .update({
        constraints: JSON.stringify([...current.constraints, constraint]),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", objectiveId)
      .select()
      .single();
    if (updated.error) throw updated.error;
    return mapObjective(updated.data as ObjectiveRow);
  }

  async updateProgress(
    organizationId: string,
    objectiveId: string,
    progress: number,
  ): Promise<BusinessObjective | null> {
    const clamped = Math.max(0, Math.min(100, progress));
    const { data, error } = await this.admin
      .from("marketing_objectives")
      .update({
        progress: clamped,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", objectiveId)
      .select()
      .single();
    if (error) throw error;
    return mapObjective(data as ObjectiveRow);
  }
}

export class SupabaseMarketingActivityRepository
  implements MarketingActivityRepository
{
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async create(input: {
    organizationId: string;
    departmentId: "marketing";
    objectiveId?: string;
    actor: string;
    type: DepartmentActivity["kind"];
    message: string;
  }): Promise<DepartmentActivity> {
    const { data, error } = await this.admin
      .from("marketing_activity")
      .insert({
        organization_id: input.organizationId,
        department_id: DEPT,
        ...(input.objectiveId ? { objective_id: input.objectiveId } : {}),
        actor: input.actor,
        type: input.type,
        message: input.message,
      })
      .select()
      .single();
    if (error) throw error;
    return mapActivity(data as ActivityRow);
  }

  async listRecent(
    organizationId: string,
    departmentId: "marketing",
    limit = 20,
  ): Promise<DepartmentActivity[]> {
    const { data, error } = await this.admin
      .from("marketing_activity")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("department_id", departmentId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => mapActivity(r as ActivityRow));
  }
}

export class SupabaseMarketingApprovalRepository
  implements MarketingApprovalRepository
{
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
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
    const { data, error } = await this.admin
      .from("marketing_approvals")
      .insert({
        organization_id: input.organizationId,
        department_id: DEPT,
        ...(input.objectiveId ? { objective_id: input.objectiveId } : {}),
        title: input.title,
        description: input.description,
        status: "pending",
        ...(input.cost ? { cost: input.cost } : {}),
        requested_by: input.requestedBy,
      })
      .select()
      .single();
    if (error) throw error;
    return mapApproval(data as ApprovalRow);
  }

  async list(
    organizationId: string,
    departmentId: "marketing",
  ): Promise<ApprovalRequest[]> {
    const { data, error } = await this.admin
      .from("marketing_approvals")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("department_id", departmentId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => mapApproval(r as ApprovalRow));
  }

  async decide(
    organizationId: string,
    approvalId: string,
    decision: "approve" | "reject",
    decidedBy: string,
  ): Promise<ApprovalRequest | null> {
    const { data, error } = await this.admin
      .from("marketing_approvals")
      .update({
        status: decision === "approve" ? "approved" : "rejected",
        decided_by: decidedBy,
        decided_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("id", approvalId)
      .select()
      .single();
    if (error) throw error;
    return data ? mapApproval(data as ApprovalRow) : null;
  }
}
