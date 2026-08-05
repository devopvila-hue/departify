import type { OrganizationSnapshot } from "@departify/organization-domain";
import type {
  CursorPage,
  CursorPageRequest,
} from "../pagination/pagination.js";
import type { Versioned } from "../optimistic-locking/version.js";
import type {
  OrganizationSpecification,
  PersistenceSpecification,
} from "../specifications/specification.js";
import type {
  PersistenceReadOptions,
  PersistenceWriteOptions,
} from "./repository-options.js";

export type OrganizationRecord = Versioned<OrganizationSnapshot>;

export interface OrganizationRepository {
  findById(
    organizationId: string,
    options?: PersistenceReadOptions,
  ): Promise<OrganizationRecord | null>;
  findOne(
    specification: OrganizationSpecification<OrganizationSnapshot>,
    options?: PersistenceReadOptions,
  ): Promise<OrganizationRecord | null>;
  list(
    specification: PersistenceSpecification<OrganizationSnapshot>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<OrganizationRecord>>;
  save(
    organization: OrganizationRecord,
    options?: PersistenceWriteOptions,
  ): Promise<OrganizationRecord>;
  delete(
    organizationId: string,
    options?: PersistenceWriteOptions,
  ): Promise<void>;
}
