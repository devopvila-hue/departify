import {
  AgentRuntimeValidationError,
  validateScheduledTask,
} from "../src/index.js";

describe("agent scheduling contracts", () => {
  it("validates manual, interval, and cron scheduling definitions", () => {
    expect(
      validateScheduledTask({
        id: "task_manual",
        agentId: "agent_001",
        name: "Manual task",
        trigger: { type: "manual" },
        enabled: false,
      }),
    ).toMatchObject({ trigger: { type: "manual" } });

    expect(
      validateScheduledTask({
        id: "task_interval",
        agentId: "agent_001",
        name: "Interval task",
        trigger: { type: "interval", everySeconds: 60 },
        enabled: true,
      }),
    ).toMatchObject({ trigger: { type: "interval" } });

    expect(
      validateScheduledTask({
        id: "task_cron",
        agentId: "agent_001",
        name: "Cron task",
        trigger: { type: "cron", expression: "0 * * * *" },
        enabled: true,
      }),
    ).toMatchObject({ trigger: { type: "cron" } });
  });

  it("does not accept invalid schedule definitions", () => {
    expect(() =>
      validateScheduledTask({
        id: "task_invalid",
        agentId: "agent_001",
        name: "Invalid task",
        trigger: { type: "interval", everySeconds: 0 },
        enabled: true,
      }),
    ).toThrow(AgentRuntimeValidationError);
  });
});
