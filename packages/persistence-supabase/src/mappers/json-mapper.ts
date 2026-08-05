import {
  PersistenceValidationError,
  type Versioned,
} from "@departify/persistence-contracts";
import type { Json } from "../client/json.js";
import type { SupabaseRecordRow } from "../client/database.types.js";

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function fromSupabaseRecord<TSnapshot>(
  row: SupabaseRecordRow | null,
): Versioned<TSnapshot> | null {
  if (row === null) {
    return null;
  }

  if (!isObject(row.snapshot)) {
    throw new PersistenceValidationError(
      "Supabase snapshot must be an object.",
    );
  }

  return {
    snapshot: row.snapshot as TSnapshot,
    version: row.version,
  };
}

export function toSupabaseRecord<TSnapshot>(
  id: string,
  record: Versioned<TSnapshot>,
) {
  return {
    id,
    snapshot: toJson(record.snapshot),
    version: record.version,
    updated_at: new Date().toISOString(),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
