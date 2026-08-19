/**
 * Weekly Operating Plan — durable representation of a planned week.
 *
 * The Operating Loop uses WeeklyPlan as the bridge between "Chat →
 * Plan" and "Plan → DepartmentTasks". When the CEO accepts a plan, each
 * item is materialized as a real DepartmentTask row with `plannedDate`
 * set and a `weekly_plan` source so the calendar projection picks it up.
 *
 * We do NOT introduce a separate "executable work" entity: a WeeklyPlan
 * item is just a *description* of a future DepartmentTask. The durable
 * truth lives in the same DepartmentTask store the rest of the system
 * already trusts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  DepartmentTask,
  DepartmentWorkCapability,
} from "./department-work.js";

export interface WeeklyPlanItem {
  readonly id: string;
  readonly dayOfWeek: number; // 0=Sun … 6=Sat
  readonly title: string;
  readonly summary: string;
  readonly capability: DepartmentWorkCapability;
  readonly toolId: string;
  readonly requiresApproval: boolean;
  readonly plannedHour?: number;
}

export interface WeeklyPlan {
  readonly id: string;
  readonly organizationId: string;
  readonly weekStartIso: string; // Monday of the week (YYYY-MM-DDT00:00:00Z)
  readonly objective: string;
  readonly items: readonly WeeklyPlanItem[];
  readonly status: "draft" | "accepted";
  readonly createdAt: string;
  readonly createdBy: string;
  readonly acceptedAt: string | null;
}

export interface WeeklyPlanStore {
  getCurrent(organizationId: string, weekStartIso?: string): Promise<WeeklyPlan | null>;
  get(planId: string): Promise<WeeklyPlan | null>;
  upsert(plan: WeeklyPlan): Promise<WeeklyPlan>;
  listForOrg(organizationId: string): Promise<WeeklyPlan[]>;
}

export class InMemoryWeeklyPlanStore implements WeeklyPlanStore {
  private readonly plans = new Map<string, WeeklyPlan>();
  private genId(): string {
    return `wp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async upsert(plan: WeeklyPlan): Promise<WeeklyPlan> {
    const id = plan.id || this.genId();
    const next: WeeklyPlan = { ...plan, id };
    this.plans.set(id, next);
    return next;
  }
  async get(planId: string): Promise<WeeklyPlan | null> {
    return this.plans.get(planId) ?? null;
  }
  async getCurrent(organizationId: string, weekStartIso?: string): Promise<WeeklyPlan | null> {
    const target = weekStartIso ?? currentWeekStartIso();
    const plans = [...this.plans.values()]
      .filter((p) => p.organizationId === organizationId && p.weekStartIso === target)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return plans[0] ?? null;
  }
  async listForOrg(organizationId: string): Promise<WeeklyPlan[]> {
    return [...this.plans.values()]
      .filter((p) => p.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/**
 * Compute the Monday of the current ISO week at 00:00 UTC.
 */
export function currentWeekStartIso(now: Date = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString();
}

/**
 * Compute the planned start datetime for a given week + dayOfWeek. The
 * resulting ISO timestamp carries the date the CEO picked; the actual
 * running wall-clock is irrelevant — the calendar projection only uses
 * the date portion.
 */
export function plannedDateForItem(weekStartIso: string, dayOfWeek: number, plannedHour = 9): string {
  const monday = new Date(weekStartIso);
  monday.setUTCDate(monday.getUTCDate() + Math.max(0, Math.min(6, dayOfWeek)));
  monday.setUTCHours(plannedHour, 0, 0, 0);
  return monday.toISOString();
}

/**
 * Translate a WeeklyPlan into a list of DepartmentTask *inputs*. The
 * caller (route handler) is responsible for persisting them via the
 * existing DepartmentWorkStore so they appear in Kanban + Calendar.
 */
export function materializeWeeklyPlanTasks(input: {
  organizationId: string;
  plan: WeeklyPlan;
  requestedBy: string;
}): Omit<DepartmentTask, "id" | "createdAt">[] {
  return input.plan.items.map((item) => ({
    organizationId: input.organizationId,
    departmentId: "marketing",
    objectiveId: null,
    requestedBy: input.requestedBy,
    title: item.title,
    summary: item.summary,
    capability: item.capability,
    toolId: item.toolId,
    status: "queued",
    statusMessage: "Programado en el plan semanal.",
    progress: 0,
    requiredCapabilities: [item.capability],
    startedAt: null,
    completedAt: null,
    resultId: null,
    errorCode: null,
    errorMessage: null,
    timeoutMs: 7 * 24 * 60 * 60 * 1000,
    plannedDate: plannedDateForItem(input.plan.weekStartIso, item.dayOfWeek, item.plannedHour ?? 9),
    source: {
      type: "weekly_plan",
      weekStartIso: input.plan.weekStartIso,
      dayOfWeek: item.dayOfWeek,
      planItemId: item.id,
      requiresApproval: item.requiresApproval,
    },
  }));
}

// ---------------------------------------------------------------------------
// Supabase adapter — same shape as the in-memory store. The table is
// `organization_weekly_plans` (jsonb snapshot). RLS scope: organization
// members can SELECT; backend writes via service role.
// ---------------------------------------------------------------------------

export class SupabaseWeeklyPlanStore implements WeeklyPlanStore {
  private readonly admin: SupabaseClient;
  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  async upsert(plan: WeeklyPlan): Promise<WeeklyPlan> {
    const id = plan.id || `wp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const next: WeeklyPlan = { ...plan, id };
    const { error } = await this.admin.from("organization_weekly_plans").upsert(
      {
        id,
        organization_id: next.organizationId,
        week_start_iso: next.weekStartIso,
        objective: next.objective,
        items: next.items,
        status: next.status,
        created_at: next.createdAt,
        created_by: next.createdBy,
        accepted_at: next.acceptedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    return next;
  }
  async get(planId: string): Promise<WeeklyPlan | null> {
    const { data, error } = await this.admin
      .from("organization_weekly_plans")
      .select("id, organization_id, week_start_iso, objective, items, status, created_at, created_by, accepted_at")
      .eq("id", planId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPlan(data as Record<string, unknown>) : null;
  }
  async getCurrent(organizationId: string, weekStartIso?: string): Promise<WeeklyPlan | null> {
    const target = weekStartIso ?? currentWeekStartIso();
    const { data, error } = await this.admin
      .from("organization_weekly_plans")
      .select("id, organization_id, week_start_iso, objective, items, status, created_at, created_by, accepted_at")
      .eq("organization_id", organizationId)
      .eq("week_start_iso", target)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPlan(data as Record<string, unknown>) : null;
  }
  async listForOrg(organizationId: string): Promise<WeeklyPlan[]> {
    const { data, error } = await this.admin
      .from("organization_weekly_plans")
      .select("id, organization_id, week_start_iso, objective, items, status, created_at, created_by, accepted_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapPlan(row as Record<string, unknown>));
  }
}

function mapPlan(row: Record<string, unknown>): WeeklyPlan {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    weekStartIso: String(row["week_start_iso"]),
    objective: String(row["objective"] ?? ""),
    items: (row["items"] as readonly WeeklyPlanItem[]) ?? [],
    status: (row["status"] as "draft" | "accepted") ?? "draft",
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    createdBy: String(row["created_by"] ?? ""),
    acceptedAt: (row["accepted_at"] as string | null) ?? null,
  };
}

let installedWeeklyPlanStore: WeeklyPlanStore | null = null;

export function setWeeklyPlanStore(store: WeeklyPlanStore): void {
  installedWeeklyPlanStore = store;
}

export function getWeeklyPlanStore(): WeeklyPlanStore {
  if (installedWeeklyPlanStore) return installedWeeklyPlanStore;
  installedWeeklyPlanStore = new InMemoryWeeklyPlanStore();
  return installedWeeklyPlanStore;
}

export function createInMemoryWeeklyPlanStore(): WeeklyPlanStore {
  return new InMemoryWeeklyPlanStore();
}

// ---------------------------------------------------------------------------
// Status transition — used by Kanban drag-drop. Only a small set of
// transitions are allowed without executing a capability: queued →
// cancelled, queued → running (manual start), running → cancelled,
// any → archived. Any transition that *requires* producing a result is
// delegated to the existing capability executor; the route handler
// rejects it here so the Kanban UI cannot fake completions.
// ---------------------------------------------------------------------------

const ALLOWED_MANUAL_TRANSITIONS: ReadonlyArray<readonly [DepartmentTask["status"], DepartmentTask["status"]]> = [
  ["queued", "cancelled"],
  ["queued", "running"],
  ["running", "cancelled"],
  ["running", "queued"],
  ["waiting_approval", "cancelled"],
];

export function canManualTransition(
  from: DepartmentTask["status"],
  to: DepartmentTask["status"],
): boolean {
  if (from === to) return true;
  return ALLOWED_MANUAL_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function transitionTaskStatus(
  task: DepartmentTask,
  to: DepartmentTask["status"],
): DepartmentTask {
  if (!canManualTransition(task.status, to)) {
    throw new Error(
      `Transición no permitida: ${task.status} → ${to}. Las tareas terminan cuando Departify ejecuta la capacidad que las cierra.`,
    );
  }
  // The persisted DepartmentTask is readonly; we rebuild a new object
  // with the patched fields rather than mutating in place.
  const now = new Date().toISOString();
  return {
    ...task,
    status: to,
    startedAt: to === "running" && !task.startedAt ? now : task.startedAt,
    completedAt: to === "cancelled" ? now : task.completedAt,
  };
}
