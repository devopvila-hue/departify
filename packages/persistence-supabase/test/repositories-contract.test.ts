import type {
  OrganizationRepository,
  ProvisioningRepository,
  UnitOfWork,
  WorkspaceRepository,
} from "@departify/persistence-contracts";
import {
  SupabaseOrganizationRepository,
  SupabaseProvisioningRepository,
  SupabaseUnitOfWork,
  SupabaseWorkspaceRepository,
  createDepartifySupabaseClient,
} from "../src/index.js";

describe("Supabase repository contracts", () => {
  const client = createDepartifySupabaseClient({
    url: "http://127.0.0.1:54321",
    key: "service-role-key",
  });

  it("implements persistence repository interfaces", () => {
    expectTypeOf(
      new SupabaseOrganizationRepository(client),
    ).toMatchTypeOf<OrganizationRepository>();
    expectTypeOf(
      new SupabaseWorkspaceRepository(client),
    ).toMatchTypeOf<WorkspaceRepository>();
    expectTypeOf(
      new SupabaseProvisioningRepository(client),
    ).toMatchTypeOf<ProvisioningRepository>();
  });

  it("implements UnitOfWork contract", () => {
    expectTypeOf(new SupabaseUnitOfWork(client)).toMatchTypeOf<UnitOfWork>();
  });
});
