import type { OrganizationRepository } from "../repositories/organization-repository.js";
import type { ProvisioningRepository } from "../repositories/provisioning-repository.js";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import type {
  TransactionContext,
  TransactionOptions,
} from "../transactions/transaction.js";

export interface UnitOfWorkContext {
  transaction: TransactionContext;
  organizations: OrganizationRepository;
  workspaces: WorkspaceRepository;
  provisioning: ProvisioningRepository;
}

export type UnitOfWorkCallback<TResult> = (
  context: UnitOfWorkContext,
) => Promise<TResult>;

export interface UnitOfWork {
  execute<TResult>(
    callback: UnitOfWorkCallback<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult>;
}
