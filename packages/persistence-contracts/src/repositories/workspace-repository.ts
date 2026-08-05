import type { WorkspaceSnapshot } from "@departify/organization-domain";
import type {
  CursorPage,
  CursorPageRequest,
} from "../pagination/pagination.js";
import type { Versioned } from "../optimistic-locking/version.js";
import type {
  PersistenceSpecification,
  WorkspaceSpecification,
} from "../specifications/specification.js";
import type {
  PersistenceReadOptions,
  PersistenceWriteOptions,
} from "./repository-options.js";

export type WorkspaceRecord = Versioned<WorkspaceSnapshot>;

export interface WorkspaceRepository {
  findById(
    workspaceId: string,
    options?: PersistenceReadOptions,
  ): Promise<WorkspaceRecord | null>;
  findOne(
    specification: WorkspaceSpecification<WorkspaceSnapshot>,
    options?: PersistenceReadOptions,
  ): Promise<WorkspaceRecord | null>;
  list(
    specification: PersistenceSpecification<WorkspaceSnapshot>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<WorkspaceRecord>>;
  save(
    workspace: WorkspaceRecord,
    options?: PersistenceWriteOptions,
  ): Promise<WorkspaceRecord>;
  delete(workspaceId: string, options?: PersistenceWriteOptions): Promise<void>;
}
