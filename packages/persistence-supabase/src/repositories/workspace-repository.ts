import type { WorkspaceSnapshot } from "@departify/organization-domain";
import type {
  CursorPage,
  CursorPageRequest,
  PersistenceReadOptions,
  PersistenceSpecification,
  PersistenceWriteOptions,
  WorkspaceRecord,
  WorkspaceRepository,
  WorkspaceSpecification,
} from "@departify/persistence-contracts";
import type { DepartifySupabaseClient } from "../client/supabase-client.js";
import { SupabaseRecordRepository } from "./base-record-repository.js";

export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  private readonly records: SupabaseRecordRepository<WorkspaceSnapshot>;

  constructor(client: DepartifySupabaseClient) {
    this.records = new SupabaseRecordRepository(
      client,
      "departify_workspace_records",
      (snapshot) => snapshot.id,
    );
  }

  findById(
    workspaceId: string,
    options?: PersistenceReadOptions,
  ): Promise<WorkspaceRecord | null> {
    return this.records.findById(workspaceId, options);
  }

  findOne(
    specification: WorkspaceSpecification<WorkspaceSnapshot>,
    options?: PersistenceReadOptions,
  ): Promise<WorkspaceRecord | null> {
    return this.records.findOne(specification, options);
  }

  list(
    specification: PersistenceSpecification<WorkspaceSnapshot>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<WorkspaceRecord>> {
    return this.records.list(specification, page, options);
  }

  save(
    workspace: WorkspaceRecord,
    options?: PersistenceWriteOptions,
  ): Promise<WorkspaceRecord> {
    return this.records.save(workspace, options);
  }

  delete(
    workspaceId: string,
    options?: PersistenceWriteOptions,
  ): Promise<void> {
    return this.records.delete(workspaceId, options);
  }
}
