import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export const MAX_ACTIVE_DASHBOARDS = 5;

export type DashboardWidgetKind =
  | "metric"
  | "line"
  | "bar"
  | "area"
  | "donut"
  | "table"
  | "timeline"
  | "calendar-summary";

export interface DashboardDateRange {
  readonly kind: "relative" | "fixed";
  readonly days?: number;
  readonly from?: string;
  readonly to?: string;
}

export interface DashboardWidget {
  readonly id: string;
  readonly kind: DashboardWidgetKind;
  readonly title: string;
  readonly source: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface DashboardDefinition {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly title: string;
  readonly description: string;
  readonly dateRange: DashboardDateRange;
  readonly metrics: readonly string[];
  readonly widgets: readonly DashboardWidget[];
  readonly filters: readonly string[];
  readonly dataSources: readonly string[];
  readonly layout: Readonly<Record<string, unknown>>;
  readonly status: "active" | "archived";
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateDashboardInput {
  readonly organizationId: string;
  readonly departmentId: string;
  readonly title: string;
  readonly description: string;
  readonly dateRange: DashboardDateRange;
  readonly metrics: readonly string[];
  readonly widgets: readonly DashboardWidget[];
  readonly filters: readonly string[];
  readonly dataSources: readonly string[];
  readonly layout: Readonly<Record<string, unknown>>;
  readonly createdBy?: string;
}

export class DashboardLimitError extends Error {
  constructor() {
    super("Ya hay 5 dashboards activos. Elimina uno o reutiliza uno existente.");
    this.name = "DashboardLimitError";
  }
}

export interface DepartmentDashboardStore {
  create(input: CreateDashboardInput): Promise<DashboardDefinition>;
  listForOrg(organizationId: string, departmentId?: string): Promise<DashboardDefinition[]>;
  get(organizationId: string, id: string): Promise<DashboardDefinition | null>;
  archive(organizationId: string, id: string): Promise<DashboardDefinition | null>;
  countActive(organizationId: string): Promise<number>;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class InMemoryDepartmentDashboardStore implements DepartmentDashboardStore {
  private readonly rows = new Map<string, DashboardDefinition>();

  async create(input: CreateDashboardInput): Promise<DashboardDefinition> {
    if (await this.countActive(input.organizationId) >= MAX_ACTIVE_DASHBOARDS) {
      throw new DashboardLimitError();
    }
    const now = new Date().toISOString();
    const dashboard: DashboardDefinition = {
      ...input,
      id: makeId("dashboard"),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(dashboard.id, dashboard);
    return dashboard;
  }

  async listForOrg(organizationId: string, departmentId?: string): Promise<DashboardDefinition[]> {
    return [...this.rows.values()]
      .filter((row) => row.organizationId === organizationId && row.status === "active" && (!departmentId || row.departmentId === departmentId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(organizationId: string, id: string): Promise<DashboardDefinition | null> {
    const row = this.rows.get(id);
    return row?.organizationId === organizationId ? row : null;
  }

  async archive(organizationId: string, id: string): Promise<DashboardDefinition | null> {
    const row = await this.get(organizationId, id);
    if (!row) return null;
    const updated = { ...row, status: "archived" as const, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async countActive(organizationId: string): Promise<number> {
    return [...this.rows.values()].filter((row) => row.organizationId === organizationId && row.status === "active").length;
  }
}

interface DashboardRow {
  id: string;
  organization_id: string;
  department_id: string;
  title: string;
  description: string;
  date_range: DashboardDateRange;
  metrics: string[];
  widgets: DashboardWidget[];
  filters: string[];
  data_sources: string[];
  layout: Readonly<Record<string, unknown>>;
  status: "active" | "archived";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapDashboard(row: DashboardRow): DashboardDefinition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    title: row.title,
    description: row.description,
    dateRange: row.date_range,
    metrics: row.metrics ?? [],
    widgets: row.widgets ?? [],
    filters: row.filters ?? [],
    dataSources: row.data_sources ?? [],
    layout: row.layout ?? {},
    status: row.status,
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isDashboardLimitError(error: { message?: string }): boolean {
  return error.message === "dashboard_limit" || /dashboard_limit/i.test(error.message ?? "");
}

export class SupabaseDepartmentDashboardStore implements DepartmentDashboardStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async create(input: CreateDashboardInput): Promise<DashboardDefinition> {
    const { data, error } = await this.admin.from("department_dashboards").insert({
      organization_id: input.organizationId,
      department_id: input.departmentId,
      title: input.title,
      description: input.description,
      date_range: input.dateRange,
      metrics: input.metrics,
      widgets: input.widgets,
      filters: input.filters,
      data_sources: input.dataSources,
      layout: input.layout,
      created_by: input.createdBy ?? null,
    }).select().single();
    if (error) {
      if (isDashboardLimitError(error)) throw new DashboardLimitError();
      throw error;
    }
    return mapDashboard(data as DashboardRow);
  }

  async listForOrg(organizationId: string, departmentId?: string): Promise<DashboardDefinition[]> {
    let query = this.admin.from("department_dashboards").select("*").eq("organization_id", organizationId).eq("status", "active").order("updated_at", { ascending: false });
    if (departmentId) query = query.eq("department_id", departmentId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapDashboard(row as DashboardRow));
  }

  async get(organizationId: string, id: string): Promise<DashboardDefinition | null> {
    const { data, error } = await this.admin.from("department_dashboards").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapDashboard(data as DashboardRow) : null;
  }

  async archive(organizationId: string, id: string): Promise<DashboardDefinition | null> {
    const { data, error } = await this.admin.from("department_dashboards").update({ status: "archived", updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data ? mapDashboard(data as DashboardRow) : null;
  }

  async countActive(organizationId: string): Promise<number> {
    const { count, error } = await this.admin.from("department_dashboards").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active");
    if (error) throw error;
    return count ?? 0;
  }
}

let fallbackStore: DepartmentDashboardStore = new InMemoryDepartmentDashboardStore();

export function getFallbackDepartmentDashboardStore(): DepartmentDashboardStore {
  return fallbackStore;
}

export function resetFallbackDepartmentDashboardStoreForTest(): void {
  fallbackStore = new InMemoryDepartmentDashboardStore();
}
