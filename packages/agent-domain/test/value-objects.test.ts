import {
  AgentCapabilities,
  AgentDomainInvariantError,
  AgentId,
  AgentName,
  AgentPermissions,
  AgentProfile,
  AgentRole,
  DepartmentId,
} from "../src/index.js";

describe("Agent value objects", () => {
  it("normalizes valid identifiers and display fields", () => {
    expect(AgentId.create(" agt_sales001 ").toString()).toBe("agt_sales001");
    expect(DepartmentId.create(" dep_sales001 ").toString()).toBe(
      "dep_sales001",
    );
    expect(AgentName.create(" Sales   Lead ").toString()).toBe("Sales Lead");
    expect(AgentRole.create(" Sales-Lead ").toString()).toBe("sales-lead");
  });

  it("rejects invalid identity and text values", () => {
    expect(() => AgentId.create("agent_1")).toThrow(AgentDomainInvariantError);
    expect(() => DepartmentId.create("department_1")).toThrow(
      AgentDomainInvariantError,
    );
    expect(() => AgentName.create("A")).toThrow(AgentDomainInvariantError);
    expect(() => AgentRole.create("Sales Lead")).toThrow(
      AgentDomainInvariantError,
    );
  });

  it("validates capabilities", () => {
    const capabilities = AgentCapabilities.create({
      items: ["sales:read", "sales.execute"],
    });

    expect(capabilities.has("sales:read")).toBe(true);
    expect(() =>
      AgentCapabilities.create({ items: ["sales:read", "sales:read"] }),
    ).toThrow(AgentDomainInvariantError);
    expect(() => AgentCapabilities.create({ items: [] })).toThrow(
      AgentDomainInvariantError,
    );
  });

  it("validates permissions", () => {
    const permissions = AgentPermissions.create({
      items: [{ scope: "department", action: "execute" }],
    });

    expect(permissions.allows({ scope: "department", action: "execute" })).toBe(
      true,
    );
    expect(() =>
      AgentPermissions.create({
        items: [
          { scope: "department", action: "read" },
          { scope: "department", action: "read" },
        ],
      }),
    ).toThrow(AgentDomainInvariantError);
  });

  it("validates profile content", () => {
    expect(() =>
      AgentProfile.create({
        summary: "Short",
        responsibilities: ["Review"],
      }),
    ).toThrow(AgentDomainInvariantError);
    expect(() =>
      AgentProfile.create({
        summary: "Valid summary for a digital employee.",
        responsibilities: [],
      }),
    ).toThrow(AgentDomainInvariantError);
  });
});
