import type {
  TransactionOptions,
  UnitOfWork,
  UnitOfWorkCallback,
} from "@departify/persistence-contracts";
import type { DepartifySupabaseClient } from "../client/supabase-client.js";
import { SupabaseOrganizationRepository } from "../repositories/organization-repository.js";
import { SupabaseProvisioningRepository } from "../repositories/provisioning-repository.js";
import { SupabaseWorkspaceRepository } from "../repositories/workspace-repository.js";
import { SupabaseTransactionBoundary } from "./supabase-transaction.js";

export class SupabaseUnitOfWork implements UnitOfWork {
  private readonly boundary = new SupabaseTransactionBoundary();

  constructor(private readonly client: DepartifySupabaseClient) {}

  execute<TResult>(
    callback: UnitOfWorkCallback<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult> {
    return this.boundary.runInTransaction((transaction) => {
      return callback({
        transaction,
        organizations: new SupabaseOrganizationRepository(this.client),
        workspaces: new SupabaseWorkspaceRepository(this.client),
        provisioning: new SupabaseProvisioningRepository(this.client),
      });
    }, options);
  }
}
