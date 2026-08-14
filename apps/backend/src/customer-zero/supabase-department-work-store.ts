/**
 * Supabase persistence for the existing DepartmentWorkStore contract.
 *
 * This is an adapter for DepartmentTask/DepartmentResult, not a second task
 * system. Every read and write is organization-scoped and uses the backend's
 * service-role client; credentials never leave this module.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  CreateDepartmentResultInput,
  DepartmentResult,
  DepartmentTask,
  DepartmentWorkStore,
} from "./department-work.js";

interface TaskRow {
  id: string;
  organization_id: string;
  department_id: string;
  objective_id: string | null;
  requested_by: string;
  assigned_employee_id: string | null;
  title: string;
  summary: string;
  capability: DepartmentTask["capability"];
  tool_id: string;
  status: DepartmentTask["status"];
  status_message: string;
  progress: number;
  required_capabilities: DepartmentTask["requiredCapabilities"];
  source: DepartmentTask["source"] | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result_id: string | null;
  error_code: string | null;
  error_message: string | null;
  timeout_ms: number;
}

interface ResultRow {
  id: string;
  organization_id: string;
  department_id: string;
  related_work_item_id: string | null;
  title: string;
  summary: string;
  content: string;
  data: Record<string, unknown> | null;
  chart: DepartmentResult["chart"] | null;
  source: string;
  created_at: string;
  produced_by_capability: DepartmentResult["producedByCapability"];
}

function mapTask(row: TaskRow): DepartmentTask {
  return {
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    objectiveId: row.objective_id,
    requestedBy: row.requested_by,
    ...(row.assigned_employee_id ? { assignedEmployeeId: row.assigned_employee_id } : {}),
    title: row.title,
    summary: row.summary,
    capability: row.capability,
    toolId: row.tool_id,
    status: row.status,
    statusMessage: row.status_message,
    progress: Number(row.progress),
    requiredCapabilities: row.required_capabilities ?? [],
    ...(row.source ? { source: row.source } : {}),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultId: row.result_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    timeoutMs: row.timeout_ms,
  };
}

function mapResult(row: ResultRow): DepartmentResult {
  return {
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    relatedWorkItemId: row.related_work_item_id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    ...(row.data ? { data: row.data } : {}),
    ...(row.chart ? { chart: row.chart } : {}),
    source: row.source,
    createdAt: row.created_at,
    producedByCapability: row.produced_by_capability,
  };
}

export class SupabaseDepartmentWorkStore implements DepartmentWorkStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async createTask(input: Omit<DepartmentTask, "id" | "createdAt">): Promise<DepartmentTask> {
    const { data, error } = await this.admin.from("department_tasks").insert({
      organization_id: input.organizationId,
      department_id: input.departmentId,
      objective_id: input.objectiveId,
      requested_by: input.requestedBy,
      assigned_employee_id: input.assignedEmployeeId ?? null,
      title: input.title,
      summary: input.summary,
      capability: input.capability,
      tool_id: input.toolId,
      status: input.status,
      status_message: input.statusMessage,
      progress: input.progress,
      required_capabilities: input.requiredCapabilities,
      source: input.source ?? null,
      started_at: input.startedAt,
      completed_at: input.completedAt,
      result_id: input.resultId,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      timeout_ms: input.timeoutMs,
    }).select().single();
    if (error) throw error;
    return mapTask(data as TaskRow);
  }

  async updateTask(id: string, patch: Partial<DepartmentTask>): Promise<DepartmentTask> {
    const update: Record<string, unknown> = {};
    const fields: Array<[keyof DepartmentTask, string]> = [
      ["departmentId", "department_id"], ["objectiveId", "objective_id"], ["requestedBy", "requested_by"], ["assignedEmployeeId", "assigned_employee_id"],
      ["title", "title"], ["summary", "summary"], ["capability", "capability"], ["toolId", "tool_id"],
      ["status", "status"], ["statusMessage", "status_message"], ["progress", "progress"],
      ["requiredCapabilities", "required_capabilities"], ["source", "source"], ["startedAt", "started_at"],
      ["completedAt", "completed_at"], ["resultId", "result_id"], ["errorCode", "error_code"],
      ["errorMessage", "error_message"], ["timeoutMs", "timeout_ms"],
    ];
    for (const [field, column] of fields) {
      if (field in patch) update[column] = patch[field];
    }
    const { data, error } = await this.admin.from("department_tasks").update(update).eq("id", id).select().single();
    if (error) throw error;
    return mapTask(data as TaskRow);
  }

  async getTask(id: string): Promise<DepartmentTask | null> {
    const { data, error } = await this.admin.from("department_tasks").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapTask(data as TaskRow) : null;
  }

  async findTaskBySource(organizationId: string, inboxItemId: string): Promise<DepartmentTask | null> {
    const { data, error } = await this.admin.from("department_tasks").select("*")
      .eq("organization_id", organizationId).eq("source->>inboxItemId", inboxItemId).maybeSingle();
    if (error) throw error;
    return data ? mapTask(data as TaskRow) : null;
  }

  async listTasksForOrg(organizationId: string, limit = 50): Promise<DepartmentTask[]> {
    const { data, error } = await this.admin.from("department_tasks").select("*")
      .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => mapTask(row as TaskRow));
  }

  async createResult(input: CreateDepartmentResultInput): Promise<DepartmentResult> {
    const { data, error } = await this.admin.from("department_results").insert({
      organization_id: input.organizationId,
      department_id: input.departmentId,
      related_work_item_id: input.relatedWorkItemId,
      title: input.title,
      summary: input.summary,
      content: input.content,
      data: input.data ?? null,
      chart: input.chart ?? null,
      source: input.source,
      produced_by_capability: input.producedByCapability,
    }).select().single();
    if (error) throw error;
    return mapResult(data as ResultRow);
  }

  async getResult(id: string): Promise<DepartmentResult | null> {
    const { data, error } = await this.admin.from("department_results").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapResult(data as ResultRow) : null;
  }

  async listResultsForOrg(organizationId: string, limit = 50): Promise<DepartmentResult[]> {
    const { data, error } = await this.admin.from("department_results").select("*")
      .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => mapResult(row as ResultRow));
  }

  async countDashboardsForOrg(organizationId: string): Promise<number> {
    const { count, error } = await this.admin
      .from("department_results")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .not("chart", "is", null);
    if (error) throw error;
    return count ?? 0;
  }

  async recoverExpiredTasks(now = new Date()): Promise<number> {
    const { data, error } = await this.admin
      .from("department_tasks")
      .select("*")
      .in("status", ["running", "queued"])
      .limit(1000);
    if (error) throw error;
    let recovered = 0;
    for (const row of data ?? []) {
      const task = mapTask(row as TaskRow);
      const start = new Date(task.startedAt ?? task.createdAt).getTime();
      if (now.getTime() - start <= task.timeoutMs) continue;
      const message = "La tarea expiró mientras el runtime estaba reiniciándose.";
      const update = await this.admin
        .from("department_tasks")
        .update({
          status: "failed",
          status_message: message,
          completed_at: now.toISOString(),
          error_code: "TASK_TIMEOUT",
          error_message: message,
        })
        .eq("id", task.id)
        .in("status", ["running", "queued"]);
      if (update.error) throw update.error;
      recovered += 1;
    }
    return recovered;
  }

  async feedSince(organizationId: string, since: string): Promise<{
    tasks: readonly DepartmentTask[];
    results: readonly DepartmentResult[];
    serverTime: string;
  }> {
    const [tasks, results] = await Promise.all([
      this.admin.from("department_tasks").select("*").eq("organization_id", organizationId).gt("created_at", since),
      this.admin.from("department_results").select("*").eq("organization_id", organizationId).gt("created_at", since),
    ]);
    if (tasks.error) throw tasks.error;
    if (results.error) throw results.error;
    return {
      tasks: (tasks.data ?? []).map((row) => mapTask(row as TaskRow)),
      results: (results.data ?? []).map((row) => mapResult(row as ResultRow)),
      serverTime: new Date().toISOString(),
    };
  }
}
