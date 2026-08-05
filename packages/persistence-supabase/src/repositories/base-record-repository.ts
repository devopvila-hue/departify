import {
  OptimisticLockingError,
  PersistenceConflictError,
  PersistenceTransactionError,
  type CursorPage,
  type CursorPageRequest,
  type PersistenceReadOptions,
  type PersistenceSpecification,
  type PersistenceWriteOptions,
  type Versioned,
} from "@departify/persistence-contracts";
import type { SupabaseRecordTableName } from "../client/database.types.js";
import type { DepartifySupabaseClient } from "../client/supabase-client.js";
import type { SupabaseRecordSelectQuery } from "../client/supabase-client.js";
import { specificationToSupabaseFilters } from "../mappers/filter-mapper.js";
import {
  fromSupabaseRecord,
  toSupabaseRecord,
} from "../mappers/json-mapper.js";

export class SupabaseRecordRepository<TSnapshot> {
  constructor(
    private readonly client: DepartifySupabaseClient,
    private readonly tableName: SupabaseRecordTableName,
    private readonly getId: (snapshot: TSnapshot) => string,
  ) {}

  async findById(
    id: string,
    options?: PersistenceReadOptions,
  ): Promise<Versioned<TSnapshot> | null> {
    void options;
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new PersistenceTransactionError(error.message, this.tableName);
    }

    return fromSupabaseRecord<TSnapshot>(data);
  }

  async findOne(
    specification: PersistenceSpecification<TSnapshot>,
    options?: PersistenceReadOptions,
  ): Promise<Versioned<TSnapshot> | null> {
    void options;
    let query = this.client.from(this.tableName).select("*");
    query = applySpecification(query, specification);

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      throw new PersistenceTransactionError(error.message, this.tableName);
    }

    return fromSupabaseRecord<TSnapshot>(data);
  }

  async list(
    specification: PersistenceSpecification<TSnapshot>,
    page: CursorPageRequest,
    options?: PersistenceReadOptions,
  ): Promise<CursorPage<Versioned<TSnapshot>>> {
    void options;
    let query = this.client.from(this.tableName).select("*");
    query = applySpecification(query, specification);

    for (const sort of page.sort ?? []) {
      query = query.order(sort.field, { ascending: sort.direction === "asc" });
    }

    if (page.cursor !== undefined) {
      query = query.gt("id", page.cursor);
    }

    const { data, error } = await query.limit(page.limit + 1);

    if (error) {
      throw new PersistenceTransactionError(error.message, this.tableName);
    }

    const rows = data ?? [];
    const visibleRows = rows.slice(0, page.limit);

    const nextRow = visibleRows.at(-1);

    return {
      items: visibleRows.map((row) =>
        requiredRecord(fromSupabaseRecord<TSnapshot>(row)),
      ),
      ...(rows.length > page.limit && nextRow !== undefined
        ? { nextCursor: nextRow.id }
        : {}),
      hasMore: rows.length > page.limit,
    };
  }

  async save(
    record: Versioned<TSnapshot>,
    options?: PersistenceWriteOptions,
  ): Promise<Versioned<TSnapshot>> {
    const id = this.getId(record.snapshot);
    const row = toSupabaseRecord(id, record);

    if (options?.expectedVersion !== undefined) {
      const { data, error } = await this.client
        .from(this.tableName)
        .update(row)
        .eq("id", id)
        .eq("version", options.expectedVersion.value)
        .select("*")
        .maybeSingle();

      if (error) {
        throw new PersistenceTransactionError(error.message, this.tableName);
      }

      if (data === null) {
        throw new OptimisticLockingError("Record version mismatch.", id);
      }

      return requiredRecord(fromSupabaseRecord<TSnapshot>(data));
    }

    const { data, error } = await this.client
      .from(this.tableName)
      .upsert(row, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      throw new PersistenceConflictError(error.message, this.tableName);
    }

    return requiredRecord(fromSupabaseRecord<TSnapshot>(data));
  }

  async delete(id: string, options?: PersistenceWriteOptions): Promise<void> {
    let query = this.client.from(this.tableName).delete().eq("id", id);

    if (options?.expectedVersion !== undefined) {
      query = query.eq("version", options.expectedVersion.value);
    }

    const { data, error } = await query.select("*").maybeSingle();

    if (error) {
      throw new PersistenceTransactionError(error.message, this.tableName);
    }

    if (options?.expectedVersion !== undefined && data === null) {
      throw new OptimisticLockingError("Record version mismatch.", id);
    }
  }
}

function applySpecification<TSnapshot, TQuery extends QueryLike>(
  query: TQuery,
  specification: PersistenceSpecification<TSnapshot>,
): TQuery {
  let nextQuery = query;
  for (const filter of specificationToSupabaseFilters(specification)) {
    if (filter.operator === "in" && Array.isArray(filter.value)) {
      nextQuery = nextQuery.in(filter.path, [...filter.value]) as TQuery;
    } else {
      nextQuery = nextQuery.filter(
        filter.path,
        filter.operator,
        filter.value,
      ) as TQuery;
    }
  }
  return nextQuery;
}

function requiredRecord<TSnapshot>(
  record: Versioned<TSnapshot> | null,
): Versioned<TSnapshot> {
  if (record === null) {
    throw new PersistenceTransactionError("Expected Supabase record.");
  }
  return record;
}

type QueryLike = SupabaseRecordSelectQuery;
