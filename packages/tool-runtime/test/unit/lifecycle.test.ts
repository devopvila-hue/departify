import {
  assertTransition,
  canTransition,
  isExecutable,
  isVisible,
} from "../../src/index.js";

describe("Tool lifecycle", () => {
  it("allows registered → active, suspended and retired", () => {
    expect(canTransition("registered", "active")).toBe(true);
    expect(canTransition("registered", "suspended")).toBe(true);
    expect(canTransition("registered", "retired")).toBe(true);
  });

  it("allows active → suspended and retired only", () => {
    expect(canTransition("active", "suspended")).toBe(true);
    expect(canTransition("active", "retired")).toBe(true);
    expect(canTransition("active", "registered")).toBe(false);
  });

  it("blocks transitions out of retired", () => {
    expect(canTransition("retired", "active")).toBe(false);
    expect(canTransition("retired", "registered")).toBe(false);
  });

  it("blocks suspended → registered", () => {
    expect(canTransition("suspended", "registered")).toBe(false);
    expect(canTransition("suspended", "active")).toBe(true);
  });

  it("assertTransition throws on illegal transitions", () => {
    expect(() => assertTransition("retired", "active")).toThrow();
    expect(() => assertTransition("active", "registered")).toThrow();
  });

  it("marks active tools as executable", () => {
    expect(
      isExecutable({
        status: "active",
        definition: {} as never,
        registeredAt: "",
      }),
    ).toBe(true);
    expect(
      isExecutable({
        status: "suspended",
        definition: {} as never,
        registeredAt: "",
      }),
    ).toBe(false);
  });

  it("marks retired tools as invisible", () => {
    expect(
      isVisible({
        status: "retired",
        definition: {} as never,
        registeredAt: "",
      }),
    ).toBe(false);
    expect(
      isVisible({
        status: "active",
        definition: {} as never,
        registeredAt: "",
      }),
    ).toBe(true);
  });
});
