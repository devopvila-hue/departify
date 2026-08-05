import type {
  OrganizationRecord,
  OrganizationRepository,
  ProvisioningRecord,
  ProvisioningRepository,
  WorkspaceRecord,
  WorkspaceRepository,
} from "../src/index.js";

describe("repository contracts", () => {
  it("defines organization repository methods as contracts", () => {
    const repository = {} as OrganizationRepository;

    expectTypeOf(repository.findById).toBeFunction();
    expectTypeOf(repository.findOne).toBeFunction();
    expectTypeOf(repository.list).toBeFunction();
    expectTypeOf(repository.save).toBeFunction();
    expectTypeOf(repository.delete).toBeFunction();
  });

  it("defines workspace and provisioning repository contracts", () => {
    const workspaceRepository = {} as WorkspaceRepository;
    const provisioningRepository = {} as ProvisioningRepository;

    expectTypeOf(workspaceRepository.save).toBeFunction();
    expectTypeOf(provisioningRepository.save).toBeFunction();
  });

  it("keeps records versioned", () => {
    expectTypeOf<OrganizationRecord>().toHaveProperty("version").toBeString();
    expectTypeOf<WorkspaceRecord>().toHaveProperty("version").toBeString();
    expectTypeOf<ProvisioningRecord>().toHaveProperty("version").toBeString();
  });
});
