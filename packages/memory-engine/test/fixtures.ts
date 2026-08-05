import type { CreateMemoryInput, MemoryRecordSnapshot } from "../src/index.js";
import { MemoryRecord } from "../src/index.js";

export function memoryInput(
  overrides: Partial<CreateMemoryInput> = {},
): CreateMemoryInput {
  return {
    id: "mem_operations001",
    organizationId: "org_departify01",
    ownerId: "agt_operations01",
    sessionId: "ses_operations01",
    kind: "working",
    scope: "agent",
    content: "Customer onboarding requires follow up this week.",
    priority: 80,
    tags: ["onboarding", "customer"],
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    ...overrides,
  };
}

export function memorySnapshot(
  overrides: Partial<MemoryRecordSnapshot> = {},
): MemoryRecordSnapshot {
  return {
    ...MemoryRecord.create(memoryInput()).toSnapshot(),
    ...overrides,
  };
}
