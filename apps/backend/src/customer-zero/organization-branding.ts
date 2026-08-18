/**
 * Organization branding — durable storage of company-level brand assets
 * (logo + brand name) with Supabase Storage as the asset backend.
 *
 * Design:
 *
 *   - DB (`organization_branding`) stores the durable REFERENCE — the
 *     storage object path, MIME type, size, brand name. Never a signed URL.
 *   - Storage (`organization-assets` private bucket) holds the actual file
 *     at `organizations/<organizationId>/branding/logo.<ext>`.
 *   - On read, the backend mints a SHORT-LIVED signed URL with the service
 *     role so the portal can preview the asset without exposing the path
 *     publicly. The portal never uploads directly; the backend owns the
 *     service-role client and applies its own validation before write.
 *
 * Tenant isolation:
 *
 *   - The storage path is derived from `organizationId` server-side; the
 *     portal CANNOT specify an arbitrary path.
 *   - Membership is checked by `requireSession` on every route before any
 *     read/write/delete call.
 *   - The bucket has RLS that mirrors organization_memberships — defense in
 *     depth even though service-role writes bypass it.
 */
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export const ORGANIZATION_ASSETS_BUCKET = "organization-assets";
export const BRANDING_PATH_PREFIX = "branding" as const;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_LOGO_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutes — preview only.

export interface OrganizationBrandingRecord {
  readonly organizationId: string;
  readonly logoAssetPath: string | null;
  readonly logoMimeType: string | null;
  readonly logoSizeBytes: number | null;
  readonly brandName: string | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface OrganizationBrandingView {
  readonly organizationId: string;
  readonly brandName: string | null;
  readonly logo: {
    readonly assetPath: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly signedUrl: string;
    readonly expiresAt: string;
  } | null;
  readonly updatedAt: string | null;
}

export interface OrganizationBrandingStore {
  get(organizationId: string): Promise<OrganizationBrandingRecord | null>;
  upsert(record: OrganizationBrandingRecord): Promise<void>;
}

export class InMemoryOrganizationBrandingStore implements OrganizationBrandingStore {
  private readonly records = new Map<string, OrganizationBrandingRecord>();

  async get(organizationId: string): Promise<OrganizationBrandingRecord | null> {
    return this.records.get(organizationId) ?? null;
  }

  async upsert(record: OrganizationBrandingRecord): Promise<void> {
    this.records.set(record.organizationId, record);
  }
}

export class SupabaseOrganizationBrandingStore implements OrganizationBrandingStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async get(organizationId: string): Promise<OrganizationBrandingRecord | null> {
    const { data, error } = await this.admin
      .from("organization_branding")
      .select(
        "organization_id,logo_asset_path,logo_mime_type,logo_size_bytes,brand_name,updated_at,updated_by",
      )
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapBrandingRow(data as Record<string, unknown>) : null;
  }

  async upsert(record: OrganizationBrandingRecord): Promise<void> {
    const { error } = await this.admin.from("organization_branding").upsert(
      {
        organization_id: record.organizationId,
        logo_asset_path: record.logoAssetPath,
        logo_mime_type: record.logoMimeType,
        logo_size_bytes: record.logoSizeBytes,
        brand_name: record.brandName,
        updated_at: new Date().toISOString(),
        updated_by: record.updatedBy,
      },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
  }
}

function mapBrandingRow(row: Record<string, unknown>): OrganizationBrandingRecord {
  return {
    organizationId: String(row["organization_id"]),
    logoAssetPath:
      typeof row["logo_asset_path"] === "string" &&
      (row["logo_asset_path"] as string).length > 0
        ? (row["logo_asset_path"] as string)
        : null,
    logoMimeType:
      typeof row["logo_mime_type"] === "string"
        ? (row["logo_mime_type"] as string)
        : null,
    logoSizeBytes:
      typeof row["logo_size_bytes"] === "number"
        ? (row["logo_size_bytes"] as number)
        : null,
    brandName:
      typeof row["brand_name"] === "string"
        ? (row["brand_name"] as string)
        : null,
    updatedAt:
      typeof row["updated_at"] === "string"
        ? (row["updated_at"] as string)
        : null,
    updatedBy:
      typeof row["updated_by"] === "string"
        ? (row["updated_by"] as string)
        : null,
  };
}

/**
 * Build the storage object path for an org's logo. Centralised so the
 * server cannot be tricked into writing outside the org namespace.
 */
export function brandingLogoPath(organizationId: string, extension: string): string {
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `organizations/${organizationId}/${BRANDING_PATH_PREFIX}/logo.${safeExt || "bin"}`;
}

export interface UploadLogoResult {
  readonly record: OrganizationBrandingRecord;
  readonly view: OrganizationBrandingView;
}

export async function uploadOrganizationLogo(options: {
  store: OrganizationBrandingStore;
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}): Promise<UploadLogoResult> {
  const mimeType = options.mimeType.toLowerCase();
  if (!ALLOWED_LOGO_MIME_TYPES.includes(mimeType)) {
    throw new BrandingValidationError(
      "unsupported_mime_type",
      "Formato no soportado. Usa PNG, JPG o WEBP.",
    );
  }
  if (options.sizeBytes <= 0) {
    throw new BrandingValidationError(
      "empty_file",
      "El archivo está vacío.",
    );
  }
  if (options.sizeBytes > MAX_LOGO_BYTES) {
    throw new BrandingValidationError(
      "file_too_large",
      `El archivo es demasiado grande (máximo ${Math.round(MAX_LOGO_BYTES / (1024 * 1024))} MB).`,
    );
  }

  const extension = mimeTypeToExtension(mimeType);
  const newPath = brandingLogoPath(options.organizationId, extension);

  // Replace existing logos. We delete the previous object first so a tenant
  // that swaps from PNG to WEBP does not leave a stale file behind.
  const previous = await options.store.get(options.organizationId);
  if (previous?.logoAssetPath && previous.logoAssetPath !== newPath) {
    await options.supabase.storage
      .from(ORGANIZATION_ASSETS_BUCKET)
      .remove([previous.logoAssetPath]);
  }

  const upload = await options.supabase.storage
    .from(ORGANIZATION_ASSETS_BUCKET)
    .upload(newPath, options.buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: "300",
    });
  if (upload.error) {
    throw new BrandingStorageError(upload.error.message);
  }

  const updatedAt = new Date().toISOString();
  const record: OrganizationBrandingRecord = {
    organizationId: options.organizationId,
    logoAssetPath: newPath,
    logoMimeType: mimeType,
    logoSizeBytes: options.sizeBytes,
    brandName: previous?.brandName ?? null,
    updatedAt,
    updatedBy: options.userId,
  };
  await options.store.upsert(record);

  const view = await projectBrandingView({
    supabase: options.supabase,
    record,
  });
  return { record, view };
}

export async function deleteOrganizationLogo(options: {
  store: OrganizationBrandingStore;
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
}): Promise<OrganizationBrandingView> {
  const existing = await options.store.get(options.organizationId);
  if (existing?.logoAssetPath) {
    await options.supabase.storage
      .from(ORGANIZATION_ASSETS_BUCKET)
      .remove([existing.logoAssetPath]);
  }
  const updatedAt = new Date().toISOString();
  const next: OrganizationBrandingRecord = {
    organizationId: options.organizationId,
    logoAssetPath: null,
    logoMimeType: null,
    logoSizeBytes: null,
    brandName: existing?.brandName ?? null,
    updatedAt,
    updatedBy: options.userId,
  };
  await options.store.upsert(next);
  return projectBrandingView({
    supabase: options.supabase,
    record: next,
  });
}

export async function projectBrandingView(options: {
  supabase: SupabaseClient;
  record: OrganizationBrandingRecord | null;
}): Promise<OrganizationBrandingView> {
  const record = options.record;
  if (!record) {
    return {
      organizationId: "",
      brandName: null,
      logo: null,
      updatedAt: null,
    };
  }
  if (!record.logoAssetPath || !record.logoMimeType || !record.logoSizeBytes) {
    return {
      organizationId: record.organizationId,
      brandName: record.brandName,
      logo: null,
      updatedAt: record.updatedAt,
    };
  }
  const { data, error } = await options.supabase.storage
    .from(ORGANIZATION_ASSETS_BUCKET)
    .createSignedUrl(record.logoAssetPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return {
      organizationId: record.organizationId,
      brandName: record.brandName,
      logo: null,
      updatedAt: record.updatedAt,
    };
  }
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return {
    organizationId: record.organizationId,
    brandName: record.brandName,
    logo: {
      assetPath: record.logoAssetPath,
      mimeType: record.logoMimeType,
      sizeBytes: record.logoSizeBytes,
      signedUrl: data.signedUrl,
      expiresAt,
    },
    updatedAt: record.updatedAt,
  };
}

export async function updateBrandName(options: {
  store: OrganizationBrandingStore;
  organizationId: string;
  userId: string;
  brandName: string | null;
}): Promise<OrganizationBrandingRecord> {
  const trimmed = options.brandName?.trim() ?? "";
  if (trimmed.length > 80) {
    throw new BrandingValidationError(
      "brand_name_too_long",
      "El nombre de la marca debe tener 80 caracteres o menos.",
    );
  }
  const existing = await options.store.get(options.organizationId);
  const record: OrganizationBrandingRecord = {
    organizationId: options.organizationId,
    logoAssetPath: existing?.logoAssetPath ?? null,
    logoMimeType: existing?.logoMimeType ?? null,
    logoSizeBytes: existing?.logoSizeBytes ?? null,
    brandName: trimmed.length > 0 ? trimmed : null,
    updatedAt: new Date().toISOString(),
    updatedBy: options.userId,
  };
  await options.store.upsert(record);
  return record;
}

function mimeTypeToExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "bin";
}

export class BrandingValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BrandingValidationError";
    this.code = code;
  }
}

export class BrandingStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandingStorageError";
  }
}

let installedBrandingStore: OrganizationBrandingStore | null = null;

export function setOrganizationBrandingStore(store: OrganizationBrandingStore): void {
  installedBrandingStore = store;
}

export function getOrganizationBrandingStore(): OrganizationBrandingStore {
  if (installedBrandingStore) return installedBrandingStore;
  installedBrandingStore = new InMemoryOrganizationBrandingStore();
  return installedBrandingStore;
}

export function createInMemoryOrganizationBrandingStore(): OrganizationBrandingStore {
  return new InMemoryOrganizationBrandingStore();
}
