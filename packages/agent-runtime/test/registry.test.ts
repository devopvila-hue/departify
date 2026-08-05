import { AgentRegistry, AgentRuntimeValidationError } from "../src/index.js";

const definition = {
  id: "agent_registry_001",
  organizationId: "org_departify01",
  displayName: "Operations Agent",
  role: "operations",
};

describe("AgentRegistry", () => {
  it("registers, gets, lists, and removes agents", () => {
    const registry = new AgentRegistry();

    expect(registry.register(definition)).toMatchObject({
      status: "registered",
      revision: 1,
    });
    expect(registry.get(definition.id)).toMatchObject({
      definition,
      status: "registered",
    });
    expect(registry.list()).toHaveLength(1);

    registry.deactivate(definition.id);
    registry.remove(definition.id);

    expect(registry.get(definition.id)).toBeNull();
  });

  it("prevents duplicate or invalid registrations", () => {
    const registry = new AgentRegistry();

    registry.register(definition);
    expect(() => registry.register(definition)).toThrow(
      AgentRuntimeValidationError,
    );
    expect(() =>
      registry.register({
        ...definition,
        id: " ",
      }),
    ).toThrow(AgentRuntimeValidationError);
  });
});
