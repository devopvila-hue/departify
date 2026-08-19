import type { CalendarEvent } from "./google-calendar-adapter.js";
import type { DepartmentResult, DepartmentTask } from "./department-work.js";

export type BusinessCalendarType = "task" | "result" | "approval" | "meeting";
export type BusinessCalendarStatus = "pending" | "needs_approval" | "scheduled" | "completed" | "failed" | "cancelled";

export interface BusinessCalendarEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly type: BusinessCalendarType;
  readonly status: BusinessCalendarStatus;
  readonly title: string;
  readonly summary: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly source: "departify" | "google_calendar";
  readonly sourceId: string;
  readonly capability?: string;
}

export interface CalendarApprovalLike {
  readonly id: string;
  readonly departmentId?: string;
  readonly title: string;
  readonly description?: string;
  readonly status: string;
  readonly createdAt: string;
}

function dayEnd(iso: string): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + 30);
  return date.toISOString();
}

function taskStatus(status: DepartmentTask["status"]): BusinessCalendarStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "waiting_approval") return "needs_approval";
  return "pending";
}

function approvalStatus(status: string): BusinessCalendarStatus {
  if (status === "approved") return "completed";
  if (status === "rejected") return "failed";
  return "needs_approval";
}

/**
 * Projects existing durable work into one business calendar shape. It does
 * not create a second event store: the source id remains the idempotency key
 * and callers can combine more providers without duplicating entries.
 */
export function projectBusinessCalendar(input: {
  organizationId: string;
  tasks: readonly DepartmentTask[];
  results: readonly DepartmentResult[];
  approvals?: readonly CalendarApprovalLike[];
  externalEvents?: readonly CalendarEvent[];
}): BusinessCalendarEntry[] {
  const entries: BusinessCalendarEntry[] = [];
  for (const task of input.tasks) {
    // Operating Loop: planned tasks project to the calendar at their
    // scheduled date so the CEO can plan a week ahead and see work
    // before it actually starts.
    const startIso = task.plannedDate ?? task.startedAt ?? task.createdAt;
    entries.push({
      id: `task:${task.id}`,
      organizationId: input.organizationId,
      departmentId: task.departmentId,
      type: "task",
      status: taskStatus(task.status),
      title: task.title,
      summary: task.summary,
      startIso,
      endIso: dayEnd(startIso),
      source: "departify",
      sourceId: task.id,
      capability: task.capability,
    });
  }
  for (const result of input.results) {
    entries.push({
      id: `result:${result.id}`,
      organizationId: input.organizationId,
      departmentId: result.departmentId,
      type: "result",
      status: "completed",
      title: result.title,
      summary: result.summary,
      startIso: result.createdAt,
      endIso: dayEnd(result.createdAt),
      source: "departify",
      sourceId: result.id,
      capability: result.producedByCapability,
    });
  }
  for (const approval of input.approvals ?? []) {
    entries.push({
      id: `approval:${approval.id}`,
      organizationId: input.organizationId,
      departmentId: approval.departmentId ?? "marketing",
      type: "approval",
      status: approvalStatus(approval.status),
      title: approval.title,
      summary: approval.description ?? "",
      startIso: approval.createdAt,
      endIso: dayEnd(approval.createdAt),
      source: "departify",
      sourceId: approval.id,
    });
  }
  for (const event of input.externalEvents ?? []) {
    entries.push({
      id: `google_calendar:${event.id}`,
      organizationId: input.organizationId,
      departmentId: event.businessIntent?.split(":")[0] || "dirección",
      type: "meeting",
      status: event.status === "cancelled" ? "failed" : event.status === "tentative" ? "pending" : "scheduled",
      title: event.summary,
      summary: event.description ?? "",
      startIso: event.startIso,
      endIso: event.endIso,
      source: "google_calendar",
      sourceId: event.id,
    });
  }
  const deduped = new Map<string, BusinessCalendarEntry>();
  for (const entry of entries) deduped.set(entry.id, entry);
  return [...deduped.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
}

export function filterBusinessCalendar(entries: readonly BusinessCalendarEntry[], filters: {
  departmentId?: string;
  type?: BusinessCalendarType;
  status?: BusinessCalendarStatus;
  from?: string;
  to?: string;
}): BusinessCalendarEntry[] {
  return entries.filter((entry) => {
    if (filters.departmentId && entry.departmentId !== filters.departmentId) return false;
    if (filters.type && entry.type !== filters.type) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (filters.from && entry.startIso < filters.from) return false;
    if (filters.to && entry.startIso > filters.to) return false;
    return true;
  });
}
