import { describe, expect, it } from "vitest";

import {
  DashboardLimitError,
  InMemoryDepartmentDashboardStore,
} from "../src/customer-zero/department-dashboards.js";
import { projectBusinessCalendar, filterBusinessCalendar } from "../src/customer-zero/department-calendar.js";

describe("department platform projections", () => {
  it("keeps one reusable dashboard store capped at five active definitions", async () => {
    const store = new InMemoryDepartmentDashboardStore();
    for (let index = 0; index < 5; index += 1) {
      await store.create({
        organizationId: "org-a",
        departmentId: index % 2 === 0 ? "marketing" : "seo",
        title: `Dashboard ${index + 1}`,
        description: "Real dashboard",
        dateRange: { kind: "relative", days: 21 },
        metrics: [],
        widgets: [],
        filters: [],
        dataSources: [],
        layout: {},
      });
    }
    await expect(store.create({
      organizationId: "org-a",
      departmentId: "seo",
      title: "Sixth",
      description: "",
      dateRange: { kind: "relative", days: 30 },
      metrics: [],
      widgets: [],
      filters: [],
      dataSources: [],
      layout: {},
    })).rejects.toBeInstanceOf(DashboardLimitError);
    expect(await store.countActive("org-a")).toBe(5);
    await store.archive("org-a", (await store.listForOrg("org-a"))[0]!.id);
    expect(await store.countActive("org-a")).toBe(4);
  });

  it("projects department work and external meetings without duplicating source ids", () => {
    const entries = projectBusinessCalendar({
      organizationId: "org-a",
      tasks: [{
        id: "task-1", organizationId: "org-a", departmentId: "seo", objectiveId: null, requestedBy: "user",
        title: "Auditoría SEO", summary: "web", capability: "seo.audit.website", toolId: "seo", status: "completed",
        statusMessage: "lista", progress: 1, requiredCapabilities: ["seo.audit.website"], createdAt: "2026-08-16T10:00:00.000Z",
        startedAt: "2026-08-16T10:00:00.000Z", completedAt: "2026-08-16T10:05:00.000Z", resultId: "result-1", errorCode: null,
        errorMessage: null, timeoutMs: 120000,
      }],
      results: [],
      externalEvents: [{ id: "meeting-1", summary: "Reunión", startIso: "2026-08-16T11:00:00.000Z", endIso: "2026-08-16T12:00:00.000Z", attendees: [], status: "confirmed" }],
    });
    expect(entries.map((entry) => entry.id)).toEqual(["task:task-1", "google_calendar:meeting-1"]);
    expect(filterBusinessCalendar(entries, { departmentId: "seo" })).toHaveLength(1);
    expect(filterBusinessCalendar(entries, { type: "meeting" })).toHaveLength(1);
  });
});
