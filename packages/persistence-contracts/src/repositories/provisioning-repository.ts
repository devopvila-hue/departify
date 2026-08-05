import type { OrganizationProvisioningRecord } from "@departify/provisioning-engine";
import type {
  CursorPage,
  CursorPageRequest,
} from "../pagination/pagination.js";
import type { Versioned } from "../optimistic-locking/version.js";
import type {
  PersistenceSpecification,
  ProvisioningSpecification,
} from "../specifications/specification.js";
import type {
  PersistenceReadOptions,
  PersistenceWriteOptions,
} from "./repository-options.js";

export type ProvisioningRecord = Versioned<OrganizationProvisioningRecord>;

export interface ProvisioningRepository {
  findById(
    provisioningId: string,
    options?: PersistenceReadOptions,
  ): Promise<ProvisioningRecord | null>;
  findOne(
    specification: ProvisioningSpecification<OrganizationProvisioningRecord>,
    options?: PersistenceReadOptions,
  ): Promise<ProvisioningRecord | null>;
  list(
    specification: PersistenceSpecification<OrganizationProvisioningRecord>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<ProvisioningRecord>>;
  save(
    provisioning: ProvisioningRecord,
    options?: PersistenceWriteOptions,
  ): Promise<ProvisioningRecord>;
}
