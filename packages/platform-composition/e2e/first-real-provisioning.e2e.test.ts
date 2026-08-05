import { validateEnv } from "@departify/config";
import { readFileSync } from "node:fs";
import { createSupabasePlatformComposition } from "../src/index.js";

const kongSecretPath = new URL(
  "../../../supabase/.temp/start-secrets/supabase_kong_departify/secret-0",
  import.meta.url,
);

describe("first real organization provisioning", () => {
  const composition = createSupabasePlatformComposition(
    validateEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: readLocalServiceRoleKey(),
    }),
  );

  const command = {
    type: "create_organization" as const,
    commandId: "cmd_sprint10_e2e01",
    organizationName: "Departify Sprint 10",
    initiatorId: "platform-e2e",
    metadata: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
    },
  };

  const expected = {
    organizationId: "org_departify_sprint_10_cmd_sprint10_e2e01",
    workspaceId: "wsp_departify_sprint_10_cmd_sprint10_e2e01_primary",
    provisioningId: "prv_departify_sprint_10_cmd_sprint10_e2e01",
  };

  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates an organization, workspace, and provisioning record in local Supabase", async () => {
    const result = await composition.provisioning.createOrganization(command);

    expect(result).toEqual({
      accepted: true,
      ...expected,
      state: "in_progress",
      currentStep: "create_organization",
      issues: [],
    });

    await expect(
      composition.persistence.organizations.findById(expected.organizationId),
    ).resolves.toMatchObject({
      snapshot: {
        id: expected.organizationId,
        name: "Departify Sprint 10",
        status: "created",
      },
      version: "v1",
    });

    await expect(
      composition.persistence.workspaces.findById(expected.workspaceId),
    ).resolves.toMatchObject({
      snapshot: {
        id: expected.workspaceId,
        status: "active",
      },
      version: "v1",
    });

    await expect(
      composition.persistence.provisioning.findById(expected.provisioningId),
    ).resolves.toMatchObject({
      snapshot: {
        id: expected.provisioningId,
        state: "in_progress",
        currentStep: "create_organization",
        attempts: 1,
        issues: [],
      },
      version: "v5",
    });
  });

  async function cleanup(): Promise<void> {
    await composition.persistence.organizations.delete(expected.organizationId);
    await composition.persistence.workspaces.delete(expected.workspaceId);
    await composition.persistence.provisioning.save({
      snapshot: {
        id: expected.provisioningId,
        state: "canceled",
        request: {
          requestedBy: "cleanup",
          organizationName: "cleanup",
        },
        attempts: 0,
        issues: [],
      },
      version: "cleanup",
    });
    await composition.persistence.client
      .from("departify_provisioning_records")
      .delete()
      .eq("id", expected.provisioningId)
      .select("*")
      .maybeSingle();
  }
});

function readLocalServiceRoleKey(): string {
  const kongConfig = readFileSync(kongSecretPath, "utf8");
  const match = kongConfig.match(/headers\.apikey == '(sb_secret_[^']+)'/);
  if (!match?.[1]) {
    throw new Error("Supabase local service role key was not found.");
  }
  return match[1];
}
