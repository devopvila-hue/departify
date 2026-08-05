import {
  createToolRegistry,
  InMemoryToolEventPublisher,
  ToolDuplicateError,
  ToolRegistry,
  ToolUnknownError,
  ToolValidationError,
  validateToolDefinition,
  type ToolDefinition,
} from "../../src/index.js";

function makeDefinition(
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return validateToolDefinition({
    id: "search.documents",
    version: "1.0.0",
    metadata: {
      displayName: "Document Search",
      description: "Search documents by free-text query.",
    },
    capabilities: ["idempotent"],
    requiredScopes: ["read.public"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    ...overrides,
  });
}

describe("ToolRegistry", () => {
  it("registers and retrieves a Tool", () => {
    const registry = new ToolRegistry();
    const tool = registry.register(makeDefinition());

    expect(tool.status).toBe("registered");
    expect(registry.has("search.documents")).toBe(true);
    expect(registry.get("search.documents").definition.id).toBe(
      "search.documents",
    );
  });

  it("rejects duplicate registrations", () => {
    const registry = new ToolRegistry();
    registry.register(makeDefinition());
    expect(() => registry.register(makeDefinition())).toThrow(
      ToolDuplicateError,
    );
  });

  it("retrieves tools by id and version", () => {
    const registry = new ToolRegistry();
    registry.register(makeDefinition({ version: "1.0.0" }));
    registry.register(makeDefinition({ version: "2.0.0" }));

    expect(registry.has("search.documents", "1.0.0")).toBe(true);
    expect(registry.has("search.documents", "2.0.0")).toBe(true);
    expect(registry.has("search.documents", "3.0.0")).toBe(false);
  });

  it("unregisters Tools and throws when missing", () => {
    const registry = new ToolRegistry();
    registry.register(makeDefinition());

    registry.unregister("search.documents");
    expect(registry.has("search.documents")).toBe(false);
    expect(() => registry.unregister("search.documents")).toThrow(
      ToolUnknownError,
    );
  });

  it("throws when looking up an unknown Tool", () => {
    const registry = new ToolRegistry();
    expect(() => registry.get("missing")).toThrow(ToolUnknownError);
  });

  it("lists registered Tools as immutable snapshots", () => {
    const registry = new ToolRegistry();
    registry.register(makeDefinition({ id: "first.tool" }));
    registry.register(makeDefinition({ id: "second.tool" }));

    const list = registry.list();
    expect(list.map((tool) => tool.definition.id).sort()).toEqual([
      "first.tool",
      "second.tool",
    ]);
    expect(Object.isFrozen(list[0])).toBe(true);
  });

  it("emits tool.registered and tool.unregistered events", () => {
    const publisher = new InMemoryToolEventPublisher();
    const registry = new ToolRegistry(publisher);
    registry.register(makeDefinition());
    registry.unregister("search.documents");

    const events = publisher.history();
    expect(events.map((event) => event.kind)).toEqual([
      "tool.registered",
      "tool.unregistered",
    ]);
  });

  it("validates a candidate Tool definition without registering it", () => {
    const registry = new ToolRegistry();
    const definition = registry.validate(makeDefinition());

    expect(definition.id).toBe("search.documents");
    expect(registry.has("search.documents")).toBe(false);
  });

  it("rejects invalid definitions during registration", () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register({
        id: "",
        version: "1.0.0",
        metadata: { displayName: "x", description: "x" },
        capabilities: [],
        requiredScopes: [],
        inputSchema: {},
      }),
    ).toThrow(ToolValidationError);
  });

  it("createToolRegistry helper pre-registers supplied definitions", () => {
    const registry = createToolRegistry([
      makeDefinition({ id: "a.tool" }),
      makeDefinition({ id: "b.tool" }),
    ]);
    expect(registry.has("a.tool")).toBe(true);
    expect(registry.has("b.tool")).toBe(true);
  });

  it("retires a Tool through setStatus", () => {
    const registry = new ToolRegistry();
    registry.register(makeDefinition());
    registry.setStatus("search.documents", "retired");
    expect(registry.has("search.documents")).toBe(false);
  });
});
