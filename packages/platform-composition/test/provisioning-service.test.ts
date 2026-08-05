import type {
  CursorPage,
  CursorPageRequest,
  OrganizationRecord,
  OrganizationRepository,
  PersistenceReadOptions,
  PersistenceSpecification,
  PersistenceWriteOptions,
  ProvisioningRecord,
  ProvisioningRepository,
  UnitOfWork,
  UnitOfWorkCallback,
  WorkspaceRecord,
  WorkspaceRepository,
} from "@departify/persistence-contracts";
import type {
  OrganizationSnapshot,
  WorkspaceSnapshot,
} from "@departify/organization-domain";
import type { OrganizationProvisioningRecord } from "@departify/provisioning-engine";
import { FirstRealProvisioningService } from "../src/index.js";

describe("FirstRealProvisioningService", () => {
  it("creates organization, workspace, and provisioning records through contracts", async () => {
    const unitOfWork = new InMemoryUnitOfWork();
    const service = new FirstRealProvisioningService(unitOfWork);

    const result = await service.createOrganization({
      type: "create_organization",
      commandId: "cmd_unit_001",
      organizationName: "Departify Unit",
      initiatorId: "platform-test",
    });

    expect(result).toMatchObject({
      accepted: true,
      state: "in_progress",
      currentStep: "create_organization",
      organizationId: "org_departify_unit_cmd_unit_001",
      workspaceId: "wsp_departify_unit_cmd_unit_001_primary",
    });

    await expect(
      unitOfWork.organizations.findById(result.organizationId),
    ).resolves.toMatchObject({
      snapshot: {
        status: "created",
      },
    });
    await expect(
      unitOfWork.workspaces.findById(result.workspaceId),
    ).resolves.toMatchObject({
      snapshot: {
        status: "active",
      },
    });
    await expect(
      unitOfWork.provisioning.findById(result.provisioningId),
    ).resolves.toMatchObject({
      snapshot: {
        state: "in_progress",
        currentStep: "create_organization",
      },
    });
  });
});

class InMemoryUnitOfWork implements UnitOfWork {
  readonly organizations = new InMemoryOrganizationRepository();
  readonly workspaces = new InMemoryWorkspaceRepository();
  readonly provisioning = new InMemoryProvisioningRepository();

  execute<TResult>(callback: UnitOfWorkCallback<TResult>): Promise<TResult> {
    return callback({
      transaction: {
        id: "tx_unit",
        startedAt: new Date("2026-08-05T00:00:00.000Z"),
      },
      organizations: this.organizations,
      workspaces: this.workspaces,
      provisioning: this.provisioning,
    });
  }
}

class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly records = new Map<string, OrganizationRecord>();

  async findById(id: string): Promise<OrganizationRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findOne(): Promise<OrganizationRecord | null> {
    return null;
  }

  async list(): Promise<CursorPage<OrganizationRecord>> {
    return { items: [...this.records.values()], hasMore: false };
  }

  async save(record: OrganizationRecord): Promise<OrganizationRecord> {
    this.records.set(record.snapshot.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly records = new Map<string, WorkspaceRecord>();

  async findById(id: string): Promise<WorkspaceRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findOne(): Promise<WorkspaceRecord | null> {
    return null;
  }

  async list(): Promise<CursorPage<WorkspaceRecord>> {
    return { items: [...this.records.values()], hasMore: false };
  }

  async save(record: WorkspaceRecord): Promise<WorkspaceRecord> {
    this.records.set(record.snapshot.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

class InMemoryProvisioningRepository implements ProvisioningRepository {
  private readonly records = new Map<string, ProvisioningRecord>();

  async findById(id: string): Promise<ProvisioningRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findOne(): Promise<ProvisioningRecord | null> {
    return null;
  }

  async list(): Promise<CursorPage<ProvisioningRecord>> {
    return { items: [...this.records.values()], hasMore: false };
  }

  async save(record: ProvisioningRecord): Promise<ProvisioningRecord> {
    this.records.set(record.snapshot.id, record);
    return record;
  }
}

void ({} as PersistenceReadOptions);
void ({} as PersistenceWriteOptions);
void ({} as PersistenceSpecification<OrganizationSnapshot>);
void ({} as PersistenceSpecification<WorkspaceSnapshot>);
void ({} as PersistenceSpecification<OrganizationProvisioningRecord>);
void ({} as CursorPageRequest);
