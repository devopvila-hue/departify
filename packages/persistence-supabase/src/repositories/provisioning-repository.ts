import type { OrganizationProvisioningRecord } from "@departify/provisioning-engine";
import type {
  CursorPage,
  CursorPageRequest,
  PersistenceReadOptions,
  PersistenceSpecification,
  PersistenceWriteOptions,
  ProvisioningRecord,
  ProvisioningRepository,
  ProvisioningSpecification,
} from "@departify/persistence-contracts";
import type { DepartifySupabaseClient } from "../client/supabase-client.js";
import { SupabaseRecordRepository } from "./base-record-repository.js";

export class SupabaseProvisioningRepository implements ProvisioningRepository {
  private readonly records: SupabaseRecordRepository<OrganizationProvisioningRecord>;

  constructor(client: DepartifySupabaseClient) {
    this.records = new SupabaseRecordRepository(
      client,
      "departify_provisioning_records",
      (snapshot) => snapshot.id,
    );
  }

  findById(
    provisioningId: string,
    options?: PersistenceReadOptions,
  ): Promise<ProvisioningRecord | null> {
    return this.records.findById(provisioningId, options);
  }

  findOne(
    specification: ProvisioningSpecification<OrganizationProvisioningRecord>,
    options?: PersistenceReadOptions,
  ): Promise<ProvisioningRecord | null> {
    return this.records.findOne(specification, options);
  }

  list(
    specification: PersistenceSpecification<OrganizationProvisioningRecord>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<ProvisioningRecord>> {
    return this.records.list(specification, page, options);
  }

  save(
    provisioning: ProvisioningRecord,
    options?: PersistenceWriteOptions,
  ): Promise<ProvisioningRecord> {
    return this.records.save(provisioning, options);
  }
}
