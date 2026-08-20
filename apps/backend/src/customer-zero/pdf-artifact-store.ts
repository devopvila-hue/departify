/**
 * PDF Artifact Store — Sprint 67 P0.5.
 *
 * Durable storage for PDF artifacts using Supabase Storage.
 * Follows the same pattern as OrganizationBranding:
 *   - DB stores the reference (path, mime, size)
 *   - Storage holds the actual bytes
 *   - Signed URLs for portal access
 *
 * Tenant isolation:
 *   - Storage path derived from organizationId server-side
 *   - Membership checked by requireSession on every route
 *   - Bucket has RLS mirroring organization_memberships
 */

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export const PDF_ARTIFACTS_BUCKET = "organization-assets";
export const PDF_PATH_PREFIX = "pdf-artifacts" as const;
export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const PDF_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export interface PdfArtifactRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly conversationId: string | null;
  readonly departmentId: string | null;
  readonly taskId: string | null;
  readonly resultId: string | null;
  readonly origin: string | null;
  readonly filename: string;
  readonly mimeType: "application/pdf";
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly createdAt: string;
}

export interface PdfArtifactView {
  readonly id: string;
  readonly organizationId: string;
  readonly filename: string;
  readonly mimeType: "application/pdf";
  readonly sizeBytes: number;
  readonly signedUrl: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface CreatePdfArtifactInput {
  readonly organizationId: string;
  readonly conversationId?: string;
  readonly departmentId?: string;
  readonly taskId?: string;
  readonly resultId?: string;
  readonly origin?: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface PdfArtifactStore {
  create(input: CreatePdfArtifactInput): Promise<PdfArtifactRecord>;
  get(id: string, organizationId: string): Promise<PdfArtifactRecord | null>;
  getView(id: string, organizationId: string): Promise<PdfArtifactView | null>;
  listForOrg(organizationId: string, limit?: number): Promise<PdfArtifactRecord[]>;
  delete(id: string, organizationId: string): Promise<boolean>;
}

export class InMemoryPdfArtifactStore implements PdfArtifactStore {
  private readonly records = new Map<string, PdfArtifactRecord>();
  private readonly bytes = new Map<string, Uint8Array>();

  private genId(): string {
    return `pdf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async create(input: CreatePdfArtifactInput): Promise<PdfArtifactRecord> {
    const id = this.genId();
    const storagePath = `${input.organizationId}/${PDF_PATH_PREFIX}/${id}.pdf`;
    const record: PdfArtifactRecord = {
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId ?? null,
      departmentId: input.departmentId ?? null,
      taskId: input.taskId ?? null,
      resultId: input.resultId ?? null,
      origin: input.origin ?? null,
      filename: input.filename,
      mimeType: "application/pdf",
      sizeBytes: input.bytes.length,
      storagePath,
      createdAt: new Date().toISOString(),
    };
    this.records.set(id, record);
    this.bytes.set(id, input.bytes);
    return record;
  }

  async get(id: string, organizationId: string): Promise<PdfArtifactRecord | null> {
    const record = this.records.get(id);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async getView(id: string, organizationId: string): Promise<PdfArtifactView | null> {
    const record = await this.get(id, organizationId);
    if (!record) return null;
    // In-memory store: return a fake signed URL
    return {
      id: record.id,
      organizationId: record.organizationId,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      signedUrl: `data:application/pdf;base64,${Buffer.from(this.bytes.get(id) ?? new Uint8Array()).toString("base64")}`,
      expiresAt: new Date(Date.now() + PDF_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      createdAt: record.createdAt,
    };
  }

  async listForOrg(organizationId: string, limit = 20): Promise<PdfArtifactRecord[]> {
    const results: PdfArtifactRecord[] = [];
    for (const record of this.records.values()) {
      if (record.organizationId === organizationId) {
        results.push(record);
        if (results.length >= limit) break;
      }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.organizationId !== organizationId) return false;
    this.records.delete(id);
    this.bytes.delete(id);
    return true;
  }
}

export class SupabasePdfArtifactStore implements PdfArtifactStore {
  private readonly admin: SupabaseClient;
  private readonly config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  private genId(): string {
    return `pdf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async create(input: CreatePdfArtifactInput): Promise<PdfArtifactRecord> {
    const id = this.genId();
    const storagePath = `${input.organizationId}/${PDF_PATH_PREFIX}/${id}.pdf`;

    // Upload to Supabase Storage
    const { error: uploadError } = await this.admin.storage
      .from(PDF_ARTIFACTS_BUCKET)
      .upload(storagePath, input.bytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF artifact: ${uploadError.message}`);
    }

    // Store reference in database
    const record: PdfArtifactRecord = {
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId ?? null,
      departmentId: input.departmentId ?? null,
      taskId: input.taskId ?? null,
      resultId: input.resultId ?? null,
      origin: input.origin ?? null,
      filename: input.filename,
      mimeType: "application/pdf",
      sizeBytes: input.bytes.length,
      storagePath,
      createdAt: new Date().toISOString(),
    };

    const { error: dbError } = await this.admin
      .from("pdf_artifacts")
      .insert({
        id: record.id,
        organization_id: record.organizationId,
        conversation_id: record.conversationId,
        department_id: record.departmentId,
        task_id: record.taskId,
        result_id: record.resultId,
        origin: record.origin,
        filename: record.filename,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        storage_path: record.storagePath,
        created_at: record.createdAt,
      });

    if (dbError) {
      // Clean up storage on DB failure
      await this.admin.storage.from(PDF_ARTIFACTS_BUCKET).remove([storagePath]);
      throw new Error(`Failed to store PDF artifact reference: ${dbError.message}`);
    }

    return record;
  }

  async get(id: string, organizationId: string): Promise<PdfArtifactRecord | null> {
    const { data, error } = await this.admin
      .from("pdf_artifacts")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      conversationId: data.conversation_id,
      departmentId: data.department_id,
      taskId: data.task_id,
      resultId: data.result_id,
      origin: data.origin,
      filename: data.filename,
      mimeType: data.mime_type,
      sizeBytes: data.size_bytes,
      storagePath: data.storage_path,
      createdAt: data.created_at,
    };
  }

  async getView(id: string, organizationId: string): Promise<PdfArtifactView | null> {
    const record = await this.get(id, organizationId);
    if (!record) return null;

    // Generate signed URL
    const { data: signedUrlData, error: signedUrlError } = await this.admin.storage
      .from(PDF_ARTIFACTS_BUCKET)
      .createSignedUrl(record.storagePath, PDF_SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      return null;
    }

    return {
      id: record.id,
      organizationId: record.organizationId,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      signedUrl: signedUrlData.signedUrl,
      expiresAt: new Date(Date.now() + PDF_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      createdAt: record.createdAt,
    };
  }

  async listForOrg(organizationId: string, limit = 20): Promise<PdfArtifactRecord[]> {
    const { data, error } = await this.admin
      .from("pdf_artifacts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      conversationId: row.conversation_id,
      departmentId: row.department_id,
      taskId: row.task_id,
      resultId: row.result_id,
      origin: row.origin,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storagePath: row.storage_path,
      createdAt: row.created_at,
    }));
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const record = await this.get(id, organizationId);
    if (!record) return false;

    // Delete from storage
    await this.admin.storage.from(PDF_ARTIFACTS_BUCKET).remove([record.storagePath]);

    // Delete from database
    const { error } = await this.admin
      .from("pdf_artifacts")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);

    return !error;
  }
}
