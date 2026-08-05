import { validateEnv } from "@departify/config";
import { readFileSync } from "node:fs";
import {
  OptimisticLockingError,
  type OrganizationRepository,
} from "@departify/persistence-contracts";
import {
  createSupabasePersistenceAdapter,
  createSupabasePersistenceConfig,
} from "../src/index.js";
import {
  organizationSnapshot,
  provisioningRecord,
  workspaceSnapshot,
} from "../test/fixtures.js";

const kongSecretPath = new URL(
  "../../../supabase/.temp/start-secrets/supabase_kong_departify/secret-0",
  import.meta.url,
);

describe("Supabase persistence adapter against local Supabase", () => {
  const adapter = createSupabasePersistenceAdapter(
    createSupabasePersistenceConfig(
      validateEnv({
        NODE_ENV: "test",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE_KEY: readLocalServiceRoleKey(),
      }),
    ),
  );

  it("persists and reads organization records", async () => {
    const repository: OrganizationRepository = adapter.organizations;
    const snapshot = organizationSnapshot("org_integration01");

    await repository.delete(snapshot.id);
    const saved = await repository.save({ snapshot, version: "v1" });
    const found = await repository.findById(snapshot.id);

    expect(saved).toEqual({ snapshot, version: "v1" });
    expect(found).toEqual({ snapshot, version: "v1" });
  });

  it("persists workspace and provisioning records", async () => {
    const workspace = workspaceSnapshot("wsp_integration01");
    const provisioning = provisioningRecord("prv_integration01");

    await adapter.workspaces.delete(workspace.id);
    await adapter.workspaces.save({ snapshot: workspace, version: "v1" });
    await adapter.provisioning.save({ snapshot: provisioning, version: "v1" });

    await expect(adapter.workspaces.findById(workspace.id)).resolves.toEqual({
      snapshot: workspace,
      version: "v1",
    });
    await expect(
      adapter.provisioning.findById(provisioning.id),
    ).resolves.toEqual({
      snapshot: provisioning,
      version: "v1",
    });
  });

  it("enforces optimistic locking through version predicates", async () => {
    const snapshot = organizationSnapshot("org_integration_lock");

    await adapter.organizations.delete(snapshot.id);
    await adapter.organizations.save({ snapshot, version: "v1" });

    await expect(
      adapter.organizations.save(
        { snapshot: { ...snapshot, name: "Updated" }, version: "v2" },
        { expectedVersion: { value: "stale" } },
      ),
    ).rejects.toBeInstanceOf(OptimisticLockingError);

    await expect(
      adapter.organizations.save(
        { snapshot: { ...snapshot, name: "Updated" }, version: "v2" },
        { expectedVersion: { value: "v1" } },
      ),
    ).resolves.toMatchObject({
      snapshot: { name: "Updated" },
      version: "v2",
    });
  });

  it("exposes repositories through UnitOfWork context", async () => {
    await expect(
      adapter.unitOfWork.execute(async (context) => {
        expect(context.transaction.id).toMatch(/^supabase_tx_/);
        return context.organizations.findById("org_integration01");
      }),
    ).resolves.toMatchObject({
      snapshot: {
        id: "org_integration01",
      },
    });
  });
});

function readLocalServiceRoleKey(): string {
  const kongConfig = readFileSync(kongSecretPath, "utf8");
  const match = kongConfig.match(/headers\.apikey == '(sb_secret_[^']+)'/);
  if (!match?.[1]) {
    throw new Error("Supabase local service role key was not found.");
  }
  return match[1];
}
