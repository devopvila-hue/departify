import {
  buildMemoryContext,
  MemoryEngineValidationError,
  MemoryRecord,
} from "../src/index.js";
import { memoryInput, memorySnapshot } from "./fixtures.js";

describe("memory context", () => {
  it("builds an agent context from active organization memories", () => {
    const high = memorySnapshot({
      id: "mem_high",
      priority: 90,
      content: "High priority fact.",
    });
    const low = memorySnapshot({
      id: "mem_low",
      priority: 10,
      content: "Low priority fact.",
    });
    const archived = MemoryRecord.create(memoryInput({ id: "mem_archived" }));
    archived.archive();

    const context = buildMemoryContext(
      {
        organizationId: "org_departify01",
        agentId: "agt_operations01",
        sessionId: "ses_operations01",
        maxItems: 2,
        maxCharacters: 200,
      },
      [low, archived.toSnapshot(), high],
    );

    expect(context.memories.map((memory) => memory.id)).toEqual([
      "mem_high",
      "mem_low",
    ]);
    expect(context.characterCount).toBeGreaterThan(0);
  });

  it("validates context requests", () => {
    expect(() =>
      buildMemoryContext(
        {
          organizationId: " ",
          agentId: "agt_operations01",
          maxItems: 1,
          maxCharacters: 100,
        },
        [],
      ),
    ).toThrow(MemoryEngineValidationError);
  });
});
