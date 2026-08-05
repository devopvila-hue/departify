import {
  DefaultCancellationPolicy,
  DefaultIsolationPolicy,
  DefaultLimitPolicy,
  FifoToolScheduler,
  ScopeBasedAuthorizationPolicy,
  assertScopeCompatibility,
  validateToolDefinition,
} from "../../src/index.js";

function makeDefinition(
  capabilities: readonly string[],
  scopes: readonly string[],
  limits?: { timeoutMs: number },
): ReturnType<typeof validateToolDefinition> {
  return validateToolDefinition({
    id: "x",
    version: "1.0.0",
    metadata: { displayName: "x", description: "x" },
    capabilities,
    requiredScopes: scopes,
    inputSchema: { type: "object" },
    ...(limits ? { limits } : {}),
  });
}

describe("Default security policies", () => {
  it("isolates tools with network or filesystem access at process level", () => {
    const policy = new DefaultIsolationPolicy();
    expect(
      policy.minimumIsolationFor(
        makeDefinition(["network_access"], ["read.public"]),
      ),
    ).toBe("process");
    expect(
      policy.minimumIsolationFor(
        makeDefinition(["filesystem_access"], ["read.public"]),
      ),
    ).toBe("process");
    expect(
      policy.minimumIsolationFor(
        makeDefinition(["idempotent"], ["read.public"]),
      ),
    ).toBe("logical");
  });

  it("marks cancellable and long_running tools as cancellable", () => {
    const policy = new DefaultCancellationPolicy();
    expect(
      policy.isCancellable(makeDefinition(["cancellable"], ["read.public"])),
    ).toBe(true);
    expect(
      policy.isCancellable(makeDefinition(["long_running"], ["read.public"])),
    ).toBe(true);
    expect(
      policy.isCancellable(makeDefinition(["idempotent"], ["read.public"])),
    ).toBe(false);
  });

  it("merges Tool and override limits", () => {
    const policy = new DefaultLimitPolicy();
    const tool = makeDefinition(["idempotent"], ["read.public"], {
      timeoutMs: 250,
    });
    const merged = policy.effectiveLimits(tool, { maxRetries: 5 });
    expect(merged.timeoutMs).toBe(250);
    expect(merged.maxRetries).toBe(5);
  });

  it("applies default limits when neither tool nor override supply them", () => {
    const policy = new DefaultLimitPolicy();
    const tool = makeDefinition(["idempotent"], ["read.public"]);
    const merged = policy.effectiveLimits(tool);
    expect(merged.timeoutMs).toBeGreaterThan(0);
    expect(merged.maxOutputBytes).toBeGreaterThan(0);
    expect(merged.maxRetries).toBe(0);
  });

  it("rejects shell, network and filesystem scopes under logical isolation", () => {
    expect(() =>
      assertScopeCompatibility(["execute.shell"], "logical"),
    ).toThrow();
    expect(() =>
      assertScopeCompatibility(["execute.network"], "logical"),
    ).toThrow();
    expect(() =>
      assertScopeCompatibility(["execute.filesystem"], "logical"),
    ).toThrow();
    expect(() =>
      assertScopeCompatibility(["read.public"], "logical"),
    ).not.toThrow();
    expect(() =>
      assertScopeCompatibility(["execute.shell"], "process"),
    ).not.toThrow();
  });
});

describe("ScopeBasedAuthorizationPolicy", () => {
  it("grants when caller has every required scope", () => {
    const policy = new ScopeBasedAuthorizationPolicy();
    const tool = makeDefinition(
      ["idempotent"],
      ["read.public", "write.private"],
    );
    expect(
      policy.authorize({
        definition: tool,
        request: {
          requestId: "r1",
          toolId: "x",
          args: {},
        },
        grantedScopes: ["read.public", "write.private"],
      }).allowed,
    ).toBe(true);
  });

  it("denies when caller is missing scopes", () => {
    const policy = new ScopeBasedAuthorizationPolicy();
    const tool = makeDefinition(["idempotent"], ["write.private"]);
    const decision = policy.authorize({
      definition: tool,
      request: { requestId: "r1", toolId: "x", args: {} },
      grantedScopes: ["read.public"],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain("write.private");
    }
  });
});

describe("FifoToolScheduler", () => {
  it("assigns a stable priority and acceptedAt timestamp", () => {
    const scheduler = new FifoToolScheduler();
    const tool = makeDefinition(["idempotent"], ["read.public"]);
    const request = {
      requestId: "r1",
      toolId: "x",
      args: {},
    };
    const decision = scheduler.schedule(tool, request);
    expect(decision.toolId).toBe("x");
    expect(decision.requestId).toBe("r1");
    expect(decision.priority).toBe(0);
    expect(typeof decision.acceptedAt).toBe("string");
  });
});
