import type {
  MemoryRecordStore,
  MemoryRetrievalPort,
  MemoryRetrievalRequest,
} from "../src/index.js";
import { MemorySession, memorySessionStatuses } from "../src/index.js";
import { memoryInput, memorySnapshot } from "./fixtures.js";

describe("sessions and contracts", () => {
  it("models memory sessions", () => {
    expect(memorySessionStatuses).toEqual(["open", "closed", "expired"]);

    const session = MemorySession.open({
      id: "ses_operations01",
      organizationId: "org_departify01",
      agentId: "agt_operations01",
      openedAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(session.close().toSnapshot()).toMatchObject({
      id: "ses_operations01",
      status: "closed",
    });
  });

  it("defines retrieval contracts without implementing storage", async () => {
    const port: MemoryRetrievalPort = {
      async retrieve(request: MemoryRetrievalRequest) {
        return {
          memories: [
            memorySnapshot({
              organizationId: request.organizationId,
            }),
          ],
        };
      },
    };

    await expect(
      port.retrieve({
        organizationId: "org_departify01",
        agentId: "agt_operations01",
        policy: {
          kinds: ["working"],
          scopes: ["agent"],
        },
        limit: 1,
      }),
    ).resolves.toMatchObject({
      memories: [
        expect.objectContaining({ organizationId: "org_departify01" }),
      ],
    });
  });

  it("defines record store contracts without concrete persistence", async () => {
    const store: MemoryRecordStore = {
      async create(input) {
        return memorySnapshot(input);
      },
      async update(memory) {
        return memory;
      },
      async getById(id) {
        return memorySnapshot({ id });
      },
    };

    await expect(store.create(memoryInput())).resolves.toMatchObject({
      id: "mem_operations001",
    });
  });
});
