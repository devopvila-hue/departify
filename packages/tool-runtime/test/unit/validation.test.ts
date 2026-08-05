import {
  validateLifecycleStatus,
  validateToolDefinition,
  validateToolRequest,
  ToolValidationError,
} from "../../src/index.js";

describe("Tool validation", () => {
  it("rejects definitions missing required fields", () => {
    expect(() =>
      validateToolDefinition({
        id: "",
        version: "1.0.0",
        metadata: { displayName: "x", description: "y" },
        capabilities: ["idempotent"],
        requiredScopes: [],
        inputSchema: { type: "object" },
      }),
    ).toThrow(ToolValidationError);

    expect(() =>
      validateToolDefinition({
        id: "ok",
        version: "1.0.0",
        metadata: { displayName: "x", description: "y" },
        capabilities: [],
        requiredScopes: [],
        inputSchema: { type: "object" },
      }),
    ).toThrow(ToolValidationError);
  });

  it("rejects unknown capabilities", () => {
    expect(() =>
      validateToolDefinition({
        id: "x",
        version: "1.0.0",
        metadata: { displayName: "x", description: "y" },
        capabilities: ["bogus"],
        requiredScopes: [],
        inputSchema: { type: "object" },
      }),
    ).toThrow(ToolValidationError);
  });

  it("rejects unknown scopes", () => {
    expect(() =>
      validateToolDefinition({
        id: "x",
        version: "1.0.0",
        metadata: { displayName: "x", description: "y" },
        capabilities: ["idempotent"],
        requiredScopes: ["read.bogus"],
        inputSchema: { type: "object" },
      }),
    ).toThrow(ToolValidationError);
  });

  it("accepts well-formed definitions", () => {
    const definition = validateToolDefinition({
      id: "ok",
      version: "1.0.0",
      metadata: { displayName: "OK", description: "ok tool" },
      capabilities: ["idempotent", "side_effect_free"],
      requiredScopes: ["read.public"],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    expect(definition.id).toBe("ok");
  });

  it("rejects invalid lifecycle statuses", () => {
    expect(() => validateLifecycleStatus("archived")).toThrow(
      ToolValidationError,
    );
    expect(validateLifecycleStatus("active")).toBe("active");
  });

  it("rejects requests missing requestId or toolId", () => {
    expect(() =>
      validateToolRequest({ requestId: "", toolId: "x", args: {} }),
    ).toThrow(ToolValidationError);
    expect(() =>
      validateToolRequest({ requestId: "r1", toolId: "", args: {} }),
    ).toThrow(ToolValidationError);
  });

  it("rejects requests whose args are not an object", () => {
    expect(() =>
      validateToolRequest({ requestId: "r1", toolId: "x", args: null }),
    ).toThrow(ToolValidationError);
  });

  it("accepts well-formed requests", () => {
    const request = validateToolRequest({
      requestId: "r1",
      toolId: "ok",
      args: { q: "hello" },
      organizationId: "org_1",
      agentId: "agent_1",
      metadata: { correlation: "abc" },
    });
    expect(request.requestId).toBe("r1");
    expect(request.toolId).toBe("ok");
    expect(request.organizationId).toBe("org_1");
  });
});
