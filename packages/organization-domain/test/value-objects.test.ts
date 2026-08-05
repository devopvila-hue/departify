import {
  ContactInformation,
  DomainInvariantError,
  FeatureFlags,
  License,
  Limits,
  Locale,
  OrganizationId,
  OrganizationName,
  TimeZone,
  WorkspaceId,
} from "../src/index.js";

describe("organization domain value objects", () => {
  it("normalizes valid identifiers and names", () => {
    expect(OrganizationId.create(" org_departify01 ").toString()).toBe(
      "org_departify01",
    );
    expect(WorkspaceId.create(" wsp_primary01 ").toString()).toBe(
      "wsp_primary01",
    );
    expect(OrganizationName.create(" Departify   Labs ").toString()).toBe(
      "Departify Labs",
    );
  });

  it("rejects invalid identifiers and names", () => {
    expect(() => OrganizationId.create("departify")).toThrow(
      DomainInvariantError,
    );
    expect(() => WorkspaceId.create("primary")).toThrow(DomainInvariantError);
    expect(() => OrganizationName.create("A")).toThrow(DomainInvariantError);
  });

  it("validates locale and time zone without provider dependencies", () => {
    expect(Locale.create("es-ES").toString()).toBe("es-ES");
    expect(TimeZone.create("Europe/Madrid").toString()).toBe("Europe/Madrid");
    expect(() => Locale.create("invalid locale")).toThrow();
    expect(() => TimeZone.create("Madrid")).toThrow();
  });

  it("validates license, limits, feature flags, and contact information", () => {
    expect(
      License.create({ plan: "enterprise", seats: 25 }).toSnapshot(),
    ).toEqual({
      plan: "enterprise",
      seats: 25,
    });
    expect(
      Limits.create({ maxWorkspaces: 1, maxMembers: 5 }).toSnapshot(),
    ).toEqual({
      maxWorkspaces: 1,
      maxMembers: 5,
    });
    expect(
      FeatureFlags.create({ "core.foundation": true }).isEnabled("x"),
    ).toBe(false);
    expect(
      ContactInformation.create({
        email: "HELLO@DEPARTIFY.EXAMPLE",
        website: "https://departify.example",
      }).toSnapshot(),
    ).toEqual({
      email: "hello@departify.example",
      website: "https://departify.example",
    });
  });

  it("rejects invalid domain value object payloads", () => {
    expect(() => License.create({ plan: "free", seats: 1 })).toThrow(
      DomainInvariantError,
    );
    expect(() => Limits.create({ maxWorkspaces: 0, maxMembers: 1 })).toThrow(
      DomainInvariantError,
    );
    expect(() => FeatureFlags.create({ "Bad Flag": true })).toThrow(
      DomainInvariantError,
    );
    expect(() => ContactInformation.create({ email: "invalid" })).toThrow(
      DomainInvariantError,
    );
    expect(() =>
      ContactInformation.create({ website: "http://departify.example" }),
    ).toThrow(DomainInvariantError);
  });
});
