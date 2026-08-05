import type {
  MemoryRetrievalPort,
  MemoryRetrievalRequest,
  MemoryRetrievalResult,
  MemoryRecordSnapshot,
} from "@departify/memory-engine";
import { createMemorySearchToolDefinition } from "../../src/index.js";

function fakeSnapshot(id: string): MemoryRecordSnapshot {
  return {
    id,
    organizationId: "org_departify",
    ownerId: "agent_1",
    sessionId: "session_1",
    kind: "semantic",
    scope: "agent",
    content: "hello",
    status: "active",
    priority: 50,
    tags: [],
    createdAt: new Date("2026-08-05T12:00:00Z"),
    updatedAt: new Date("2026-08-05T12:00:00Z"),
  };
}

describe("memory.search Tool", () => {
  it("returns typed memories through the retrieval port", async () => {
    const captured: { value: MemoryRetrievalRequest | null } = {
      value: null,
    };
    const port: MemoryRetrievalPort = {
      async retrieve(request) {
        captured.value = request;
        const result: MemoryRetrievalResult = {
          memories: [fakeSnapshot("mem_1"), fakeSnapshot("mem_2")],
        };
        return result;
      },
    };

    const tool = createMemorySearchToolDefinition({ port });
    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_mem_001",
      },
      { organizationId: "org_departify", limit: 5 },
      {} as AbortSignal,
    )) as unknown as { memories: MemoryRecordSnapshot[]; count: number };

    expect(captured.value?.organizationId).toBe("org_departify");
    expect(captured.value?.limit).toBe(5);
    expect(output.count).toBe(2);
    expect(output.memories.map((m) => m.id)).toEqual(["mem_1", "mem_2"]);
  });

  it("applies a default selection policy when none is supplied", async () => {
    const captured: { value: MemoryRetrievalRequest | null } = {
      value: null,
    };
    const port: MemoryRetrievalPort = {
      async retrieve(request) {
        captured.value = request;
        return { memories: [] };
      },
    };

    const tool = createMemorySearchToolDefinition({ port });
    await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_mem_002",
      },
      { organizationId: "org_departify" },
      {} as AbortSignal,
    );

    expect(captured.value?.policy.kinds.length).toBeGreaterThan(0);
    expect(captured.value?.policy.scopes.length).toBeGreaterThan(0);
  });

  it("propagates port failures as typed errors", async () => {
    const port: MemoryRetrievalPort = {
      async retrieve() {
        throw new Error("memory store offline");
      },
    };

    const tool = createMemorySearchToolDefinition({ port });
    await expect(
      tool.executor!(
        {
          toolId: tool.id,
          toolVersion: tool.version,
          requestId: "req_mem_003",
        },
        { organizationId: "org_departify" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/memory store offline/i);
  });

  it("requires read.private scope", () => {
    const tool = createMemorySearchToolDefinition({
      port: { retrieve: async () => ({ memories: [] }) },
    });
    expect(tool.requiredScopes).toEqual(["read.private"]);
  });
});
