import { createSystemUuidToolDefinition } from "../../src/index.js";

describe("system.uuid Tool", () => {
  it("generates a v4 UUID by default", async () => {
    const tool = createSystemUuidToolDefinition();
    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_uuid_001",
      },
      {},
      {} as AbortSignal,
    )) as { uuid: string; version: "v4" };

    expect(output.version).toBe("v4");
    expect(output.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("honours an explicit v4 request", async () => {
    const tool = createSystemUuidToolDefinition();
    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_uuid_002",
      },
      { version: "v4" },
      {} as AbortSignal,
    )) as { uuid: string; version: string };

    expect(output.version).toBe("v4");
    expect(typeof output.uuid).toBe("string");
    expect(output.uuid.length).toBeGreaterThan(0);
  });

  it("declares read.public scope and idempotent capabilities", () => {
    const tool = createSystemUuidToolDefinition();
    expect(tool.requiredScopes).toEqual(["read.public"]);
    expect(tool.capabilities).toEqual(
      expect.arrayContaining(["idempotent", "deterministic"]),
    );
  });
});
