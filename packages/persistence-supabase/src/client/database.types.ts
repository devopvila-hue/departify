import type { Json } from "./json.js";

export interface Database {
  public: {
    Tables: {
      departify_organization_records: SupabaseRecordTable;
      departify_workspace_records: SupabaseRecordTable;
      departify_provisioning_records: SupabaseRecordTable;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export interface SupabaseRecordTable {
  Row: SupabaseRecordRow;
  Insert: SupabaseRecordInsert;
  Update: SupabaseRecordUpdate;
  Relationships: [];
}

export interface SupabaseRecordRow {
  id: string;
  snapshot: Json;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface SupabaseRecordInsert {
  id: string;
  snapshot: Json;
  version: string;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseRecordUpdate {
  id?: string;
  snapshot?: Json;
  version?: string;
  updated_at?: string;
}

export type SupabaseRecordTableName =
  | "departify_organization_records"
  | "departify_workspace_records"
  | "departify_provisioning_records";
