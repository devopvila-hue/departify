import { Organization } from "@departify/organization-domain";
import { createOrganizationGetToolDefinition } from "../../src/index.js";

function buildOrganization(): Organization {
  return Organization.request({
    id: "org_departify",
    name: "Departify",
    brand: { displayName: "Departify" },
    license: { plan: "professional", seats: 10 },
    settings: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
      limits: {
        maxWorkspaces: 2,
        maxMembers: 10,
      },
      featureFlags: {
        foundation: true,
      },
      contactInformation: {
        email: "hello@departify.example",
        website: "https://departify.example",
      },
    },
    initialWorkspace: {
      id: "wsp_default",
      name: "Default",
    },
  });
}

describe("organization.get Tool", () => {
  it("returns the active organization snapshot when no id is supplied", async () => {
    const org = buildOrganization();
    const tool = createOrganizationGetToolDefinition({
      resolver: {
        resolve: () => ({ organization: org, snapshot: org.toSnapshot() }),
      },
    });

    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_org_001",
      },
      {},
      {} as AbortSignal,
    )) as unknown as {
      organization: { id: string };
      workspaces: { id: string }[];
    };

    expect(output.organization.id).toBe("org_departify");
    expect(output.workspaces.map((w) => w.id)).toEqual(["wsp_default"]);
  });

  it("returns the requested organization by id", async () => {
    const org = buildOrganization();
    const tool = createOrganizationGetToolDefinition({
      resolver: {
        resolve: (input) =>
          input?.organizationId === "org_departify"
            ? { organization: org, snapshot: org.toSnapshot() }
            : null,
      },
    });

    const output = (await tool.executor!(
      {
        toolId: tool.id,
        toolVersion: tool.version,
        requestId: "req_org_002",
      },
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as { organization: { id: string } };

    expect(output.organization.id).toBe("org_departify");
  });

  it("throws a typed error when the organization cannot be resolved", async () => {
    const tool = createOrganizationGetToolDefinition({
      resolver: { resolve: () => null },
    });

    await expect(
      tool.executor!(
        {
          toolId: tool.id,
          toolVersion: tool.version,
          requestId: "req_org_003",
        },
        {},
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no active organization|not found/i);
  });

  it("requires read.private scope", () => {
    const tool = createOrganizationGetToolDefinition({
      resolver: { resolve: () => null },
    });
    expect(tool.requiredScopes).toEqual(["read.private"]);
  });
});
