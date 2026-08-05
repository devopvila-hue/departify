import type { OrganizationSnapshot } from "@departify/organization-domain";
import type {
  CursorPage,
  CursorPageRequest,
  OrganizationRecord,
  OrganizationRepository,
  OrganizationSpecification,
  PersistenceReadOptions,
  PersistenceSpecification,
  PersistenceWriteOptions,
} from "@departify/persistence-contracts";
import type { DepartifySupabaseClient } from "../client/supabase-client.js";
import { SupabaseRecordRepository } from "./base-record-repository.js";

export class SupabaseOrganizationRepository implements OrganizationRepository {
  private readonly records: SupabaseRecordRepository<OrganizationSnapshot>;

  constructor(client: DepartifySupabaseClient) {
    this.records = new SupabaseRecordRepository(
      client,
      "departify_organization_records",
      (snapshot) => snapshot.id,
    );
  }

  findById(
    organizationId: string,
    options?: PersistenceReadOptions,
  ): Promise<OrganizationRecord | null> {
    return this.records.findById(organizationId, options);
  }

  findOne(
    specification: OrganizationSpecification<OrganizationSnapshot>,
    options?: PersistenceReadOptions,
  ): Promise<OrganizationRecord | null> {
    return this.records.findOne(specification, options);
  }

  list(
    specification: PersistenceSpecification<OrganizationSnapshot>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<OrganizationRecord>> {
    return this.records.list(specification, page, options);
  }

  save(
    organization: OrganizationRecord,
    options?: PersistenceWriteOptions,
  ): Promise<OrganizationRecord> {
    return this.records.save(organization, options);
  }

  delete(
    organizationId: string,
    options?: PersistenceWriteOptions,
  ): Promise<void> {
    return this.records.delete(organizationId, options);
  }
}
