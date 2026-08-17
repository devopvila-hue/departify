import { describe, expect, it } from "vitest";

import {
  classifyDurableWorkFollowUp,
  isMarketingDrivePlanRequest,
} from "../src/server/routes/customer-zero-v2.js";
import { InMemoryDepartmentWorkStore } from "../src/customer-zero/department-work.js";

describe("Chat work follow-ups", () => {
  it.each([
    ["ok", "acknowledgement"],
    ["vale", "acknowledgement"],
    ["perfecto", "acknowledgement"],
    ["gracias", "acknowledgement"],
    ["de acuerdo", "acknowledgement"],
    ["¿cómo va?", "status"],
    ["estado", "status"],
    ["¿ya está?", "status"],
    ["cancela el trabajo", "cancel"],
    ["reintenta", "retry"],
  ])("classifies %s as %s without invoking a new intent", (message, expected) => {
    expect(classifyDurableWorkFollowUp(message)).toBe(expected);
  });

  it("does not classify an explicit approval as a generic acknowledgement", () => {
    expect(classifyDurableWorkFollowUp("ok, hazlo")).toBeNull();
    expect(classifyDurableWorkFollowUp("sí, créalo")).toBeNull();
  });

  it("routes a Marketing plan saved to Drive through the durable write path", () => {
    expect(isMarketingDrivePlanRequest("Prepárame un plan de Marketing y guárdalo en Drive.")).toBe(true);
    expect(isMarketingDrivePlanRequest("¿Qué carpetas tengo en Drive?")).toBe(false);
  });

  it("keeps one durable chat operation through acknowledgement/status turns", async () => {
    const store = new InMemoryDepartmentWorkStore();
    const task = await store.createTask({
      organizationId: "org-a",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Plan de Marketing en Google Drive",
      summary: "el plan de Marketing en Google Drive",
      capability: "drive.workspace.create",
      toolId: "google_drive.workspace",
      status: "running",
      statusMessage: "Preparando el trabajo en Google Drive.",
      progress: 0.05,
      requiredCapabilities: ["drive.workspace.create"],
      startedAt: new Date().toISOString(),
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 120_000,
      source: { type: "chat_operation", operationKey: "drive_marketing_plan_workspace" },
    });

    const acknowledged = await store.listTasksForOrg("org-a");
    expect(acknowledged).toHaveLength(1);
    expect(acknowledged[0]?.id).toBe(task.id);
    expect(acknowledged[0]?.status).toBe("running");

    const completed = await store.updateTask(task.id, {
      status: "completed",
      progress: 1,
      statusMessage: "Trabajo completado en Google Drive.",
      completedAt: new Date().toISOString(),
    });
    expect(completed.status).toBe("completed");
    expect((await store.listTasksForOrg("org-a"))).toHaveLength(1);
  });

  it("persists cancellation as a terminal state without creating a replacement task", async () => {
    const store = new InMemoryDepartmentWorkStore();
    const task = await store.createTask({
      organizationId: "org-a",
      departmentId: "marketing",
      objectiveId: null,
      requestedBy: "ceo",
      title: "Trabajo cancelable",
      summary: "el trabajo",
      capability: "drive.workspace.create",
      toolId: "google_drive.workspace",
      status: "running",
      statusMessage: "En curso",
      progress: 0.2,
      requiredCapabilities: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 120_000,
      source: { type: "chat_operation", operationKey: "cancel-me" },
    });
    const cancelled = await store.updateTask(task.id, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
      errorCode: "CANCELLED_BY_USER",
    });
    expect(cancelled.status).toBe("cancelled");
    expect((await store.listTasksForOrg("org-a"))).toHaveLength(1);
  });
});
