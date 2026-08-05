export type TransactionIsolationLevel =
  "read_committed" | "repeatable_read" | "serializable";

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  timeoutMs?: number;
}

export interface TransactionContext {
  id: string;
  startedAt: Date;
  isolationLevel?: TransactionIsolationLevel;
}

export type TransactionCallback<
  TResult,
  TContext extends TransactionContext,
> = (context: TContext) => Promise<TResult>;

export interface TransactionBoundary<TContext extends TransactionContext> {
  runInTransaction<TResult>(
    callback: TransactionCallback<TResult, TContext>,
    options?: TransactionOptions,
  ): Promise<TResult>;
}
