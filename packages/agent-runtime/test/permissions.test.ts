import {
  AgentRuntimeValidationError,
  createAgentPermissionSet,
  hasAgentPermission,
} from "../src/index.js";

describe("agent permissions", () => {
  it("checks runtime permissions without provider assumptions", () => {
    const permissionSet = createAgentPermissionSet([
      { scope: "workspace", action: "read", resource: "wsp_001" },
      { scope: "runtime", action: "manage", resource: "*" },
    ]);

    expect(
      hasAgentPermission(permissionSet, {
        scope: "workspace",
        action: "read",
        resource: "wsp_001",
      }),
    ).toBe(true);
    expect(
      hasAgentPermission(permissionSet, {
        scope: "runtime",
        action: "manage",
        resource: "agent_registry",
      }),
    ).toBe(true);
    expect(
      hasAgentPermission(permissionSet, {
        scope: "workspace",
        action: "write",
        resource: "wsp_001",
      }),
    ).toBe(false);
  });

  it("rejects invalid permission resources", () => {
    expect(() =>
      createAgentPermissionSet([
        { scope: "workspace", action: "read", resource: " " },
      ]),
    ).toThrow(AgentRuntimeValidationError);
  });
});
