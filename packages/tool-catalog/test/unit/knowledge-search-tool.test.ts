import type {
  KnowledgeDocumentSnapshot,
  KnowledgeRetrievalPort,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from "@departify/knowledge-engine";
import { createKnowledgeSearchToolDefinition } from "../../src/index.js";

function fakeDocument(id: string): KnowledgeDocumentSnapshot {
  return {
    id,
    organizationId: "org_departify",
    collectionId: "col_default",
    title: `Doc ${id}`,
    contentType: "markdown",
    source: {
      id: "src_1",
      type: "manual",
      name: "Manual source",
    },
    status: "active",
    scope: "organization",
    chunks: [],
    tags: [],
    createdAt: new Date("2026-08-05T12:00:00Z"),
    updatedAt: new Date("2026-08-05T12:00:00Z"),
  };
}

describe("knowledge.search Tool", () => {
  it("returns typed documents through the retrieval port", async () => {
    const captured: { value: KnowledgeRetrievalRequest | null } = {
      value: null,
    };
    const port: KnowledgeRetrievalPort = {
      async retrieve(request) {
        captured.value = request;
        const result: KnowledgeRetrievalResult = {
          documents: [fakeDocument("doc_1")],
        };
        return result;
      },
    };

    const tool = createKnowledgeSearchToolDefinition({ port });
    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_kn_001",
      },
      { organizationId: "org_departify", query: "departify", limit: 10 },
      {} as AbortSignal,
    )) as unknown as { documents: KnowledgeDocumentSnapshot[]; count: number };

    expect(captured.value?.organizationId).toBe("org_departify");
    expect(captured.value?.query).toBe("departify");
    expect(captured.value?.limit).toBe(10);
    expect(output.count).toBe(1);
    expect(output.documents[0]?.id).toBe("doc_1");
  });

  it("applies a default selection and ranking policy when none is supplied", async () => {
    const captured: { value: KnowledgeRetrievalRequest | null } = {
      value: null,
    };
    const port: KnowledgeRetrievalPort = {
      async retrieve(request) {
        captured.value = request;
        return { documents: [] };
      },
    };

    const tool = createKnowledgeSearchToolDefinition({ port });
    await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_kn_002",
      },
      { organizationId: "org_departify", query: "hello" },
      {} as AbortSignal,
    );

    expect(captured.value?.selectionPolicy.scopes.length).toBeGreaterThan(0);
    expect(captured.value?.selectionPolicy.contentTypes.length).toBeGreaterThan(
      0,
    );
    expect(captured.value?.rankingPolicy.signals.length).toBeGreaterThan(0);
  });

  it("propagates retrieval port failures", async () => {
    const port: KnowledgeRetrievalPort = {
      async retrieve() {
        throw new Error("knowledge store offline");
      },
    };

    const tool = createKnowledgeSearchToolDefinition({ port });
    await expect(
      tool.executor!(
        {
          toolId: tool.id,
          toolVersion: tool.version,
          requestId: "req_kn_003",
        },
        { organizationId: "org_departify", query: "x" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/knowledge store offline/i);
  });

  it("requires read.private scope", () => {
    const tool = createKnowledgeSearchToolDefinition({
      port: { retrieve: async () => ({ documents: [] }) },
    });
    expect(tool.requiredScopes).toEqual(["read.private"]);
  });
});
