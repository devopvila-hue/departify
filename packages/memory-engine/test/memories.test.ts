import {
  MemoryEngineValidationError,
  MemoryRecord,
  memoryKinds,
  memoryScopes,
  memoryStatuses,
  type MemoryEngineEvent,
} from "../src/index.js";
import { memoryInput } from "./fixtures.js";

describe("MemoryRecord", () => {
  it("defines memory model dimensions", () => {
    expect(memoryKinds).toEqual([
      "working",
      "episodic",
      "semantic",
      "organization",
      "agent",
      "department",
    ]);
    expect(memoryScopes).toEqual([
      "organization",
      "department",
      "agent",
      "session",
    ]);
    expect(memoryStatuses).toEqual([
      "active",
      "archived",
      "expired",
      "deleted",
    ]);
  });

  it("creates memory and records an event", () => {
    const memory = MemoryRecord.create(memoryInput());

    expect(memory.toSnapshot()).toMatchObject({
      id: "mem_operations001",
      kind: "working",
      scope: "agent",
      status: "active",
      priority: 80,
    });
    expect(memory.pullEvents()).toEqual<MemoryEngineEvent[]>([
      {
        type: "memory.created",
        memoryId: "mem_operations001",
        kind: "working",
        scope: "agent",
        occurredAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    ]);
  });

  it("updates and transitions memory lifecycle", () => {
    const memory = MemoryRecord.create(memoryInput());
    memory.pullEvents();

    memory.updateContent(
      "Customer onboarding was completed.",
      new Date("2026-08-05T01:00:00.000Z"),
    );
    memory.archive(new Date("2026-08-05T02:00:00.000Z"));
    memory.restore(new Date("2026-08-05T03:00:00.000Z"));
    memory.expire(new Date("2026-08-05T04:00:00.000Z"));
    memory.delete(new Date("2026-08-05T05:00:00.000Z"));

    expect(memory.getStatus()).toBe("deleted");
    expect(memory.pullEvents().map((event) => event.type)).toEqual([
      "memory.updated",
      "memory.archived",
      "memory.expired",
      "memory.deleted",
    ]);
  });

  it("protects scope invariants", () => {
    const agentMemoryWithoutOwner = memoryInput({
      scope: "agent",
    });
    delete agentMemoryWithoutOwner.ownerId;
    const sessionMemoryWithoutSession = memoryInput({
      scope: "session",
    });
    delete sessionMemoryWithoutSession.sessionId;

    expect(() => MemoryRecord.create(agentMemoryWithoutOwner)).toThrow(
      MemoryEngineValidationError,
    );
    expect(() => MemoryRecord.create(sessionMemoryWithoutSession)).toThrow(
      MemoryEngineValidationError,
    );
  });
});
