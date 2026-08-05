import type { OptimisticLockingOptions } from "../optimistic-locking/version.js";
import type { TransactionContext } from "../transactions/transaction.js";

export interface PersistenceReadOptions {
  transaction?: TransactionContext;
}

export interface PersistenceWriteOptions extends OptimisticLockingOptions {
  transaction?: TransactionContext;
}
