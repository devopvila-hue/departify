import type {
  TransactionBoundary,
  TransactionCallback,
  TransactionContext,
  TransactionOptions,
} from "@departify/persistence-contracts";

export class SupabaseTransactionBoundary implements TransactionBoundary<TransactionContext> {
  async runInTransaction<TResult>(
    callback: TransactionCallback<TResult, TransactionContext>,
    options?: TransactionOptions,
  ): Promise<TResult> {
    return callback({
      id: createTransactionId(),
      startedAt: new Date(),
      ...(options?.isolationLevel === undefined
        ? {}
        : { isolationLevel: options.isolationLevel }),
    });
  }
}

function createTransactionId(): string {
  return `supabase_tx_${Date.now().toString(36)}`;
}
