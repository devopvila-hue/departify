import {
  createSystemTimeToolDefinition,
  type SystemTimeOutput,
} from "../../src/index.js";

describe("system.time Tool", () => {
  it("returns the current timestamp, timezone and ISO-8601 string", async () => {
    const tool = createSystemTimeToolDefinition();
    const fixed = new Date("2026-08-05T12:34:56.789Z");
    const clock = (): Date => fixed;

    const definitionWithClock = createSystemTimeToolDefinition({ clock });
    expect(definitionWithClock.executor).toBeDefined();

    const output = (await definitionWithClock.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_sys_time_001",
      },
      {},
      {} as AbortSignal,
    )) as SystemTimeOutput;

    expect(output.timestamp).toBe(fixed.getTime());
    expect(output.iso8601).toBe("2026-08-05T12:34:56.789Z");
    expect(typeof output.timezone).toBe("string");
    expect(output.timezone.startsWith("UTC")).toBe(true);
  });

  it("honours the optional `now` argument for deterministic runs", async () => {
    const tool = createSystemTimeToolDefinition();
    const now = 1_700_000_000_000;
    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_sys_time_002",
      },
      { now },
      {} as AbortSignal,
    )) as SystemTimeOutput;

    expect(output.timestamp).toBe(now);
    expect(output.iso8601).toBe(new Date(now).toISOString());
  });

  it("declares the read.public scope and idempotent capabilities", () => {
    const tool = createSystemTimeToolDefinition();
    expect(tool.requiredScopes).toEqual(["read.public"]);
    expect(tool.capabilities).toEqual(
      expect.arrayContaining([
        "idempotent",
        "deterministic",
        "side_effect_free",
      ]),
    );
  });
});
