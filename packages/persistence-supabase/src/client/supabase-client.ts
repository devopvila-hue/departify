import { createClient } from "@supabase/supabase-js";
import type { SupabasePersistenceConfig } from "../configuration/supabase-persistence-config.js";
import type { Database } from "./database.types.js";
import type {
  SupabaseRecordRow,
  SupabaseRecordTableName,
} from "./database.types.js";

export interface DepartifySupabaseClient {
  from(tableName: SupabaseRecordTableName): SupabaseRecordTableClient;
}

export interface SupabaseRecordTableClient {
  select(columns: string): SupabaseRecordSelectQuery;
  update(values: Record<string, unknown>): SupabaseRecordMutationQuery;
  upsert(
    values: Record<string, unknown>,
    options: { onConflict: string },
  ): SupabaseRecordMutationSelectQuery;
  delete(): SupabaseRecordMutationQuery;
}

export interface SupabaseRecordSelectQuery extends SupabaseFilterQuery {
  order(
    column: string,
    options: { ascending: boolean },
  ): SupabaseRecordSelectQuery;
  limit(count: number): Promise<SupabaseRowsResult> & SupabaseRecordSelectQuery;
  maybeSingle(): Promise<SupabaseSingleResult>;
}

export interface SupabaseRecordMutationQuery extends SupabaseFilterQuery {
  select(columns: string): SupabaseRecordMutationSelectQuery;
}

export interface SupabaseRecordMutationSelectQuery extends SupabaseRecordMutationQuery {
  single(): Promise<SupabaseSingleRequiredResult>;
  maybeSingle(): Promise<SupabaseSingleResult>;
}

export interface SupabaseFilterQuery {
  eq(column: string, value: unknown): this;
  gt(column: string, value: unknown): this;
  filter(column: string, operator: string, value: unknown): this;
  in(column: string, values: readonly unknown[]): this;
}

export interface SupabaseRowsResult {
  data: SupabaseRecordRow[] | null;
  error: SupabaseErrorLike | null;
}

export interface SupabaseSingleResult {
  data: SupabaseRecordRow | null;
  error: SupabaseErrorLike | null;
}

export interface SupabaseSingleRequiredResult {
  data: SupabaseRecordRow;
  error: SupabaseErrorLike | null;
}

export interface SupabaseErrorLike {
  message: string;
}

export function createDepartifySupabaseClient(
  config: SupabasePersistenceConfig,
): DepartifySupabaseClient {
  return createClient<Database>(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }) as unknown as DepartifySupabaseClient;
}
