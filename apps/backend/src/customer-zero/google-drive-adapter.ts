/**
 * GoogleDriveAdapter — Customer Zero 03.
 *
 * Drive capabilities behind the same Google connection used by
 * Gmail + Calendar. Capabilities:
 *   - drive.search  → searchFiles
 *   - drive.read    → readFile (metadata + small text preview)
 *   - drive.create  → createFile (only through the safe boundary)
 *
 * The adapter exposes normalized Departify-owned types. Google
 * Drive JSON never leaks past the adapter.
 */

import { gmailTokenStore } from "./gmail-adapter.js";
import {
  getGoogleTokenStore,
  googleApiFetch,
  hasGrantedScope,
  refreshGoogleToken,
} from "./google-tokens.js";

/* ----------------------------------------------------------------------------
 * Normalized types.
 * --------------------------------------------------------------------------*/

export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size?: number;
  readonly modifiedTime: string;
  readonly webViewLink?: string;
  readonly parent?: string;
  readonly parents?: readonly string[];
  readonly ownerEmail?: string;
  readonly preview?: string;
}

export interface DriveSearchInput {
  readonly query?: string;
  readonly parentId?: string;
  readonly mimeType?: string;
  readonly pageSize?: number;
}

export interface DriveListInput {
  readonly mimeType?: string;
  readonly parentId?: string;
  readonly pageSize?: number;
}

export interface DriveReadInput {
  readonly fileId: string;
}

export interface DriveCreateInput {
  readonly name: string;
  readonly mimeType?: string;
  readonly content?: string;
  readonly parentFolderId?: string;
  readonly appProperties?: Readonly<Record<string, string>>;
}

export interface DriveCreateFolderInput {
  readonly name: string;
  readonly parentFolderId?: string;
  readonly appProperties?: Readonly<Record<string, string>>;
}

export interface DriveWriteInput {
  readonly fileId: string;
  readonly content: string;
  readonly mimeType?: string;
}

export interface DriveWorkspaceDocument {
  readonly name: string;
  readonly parentFolderName: string;
  readonly content: string;
}

export interface DriveWorkspaceResult {
  readonly root: DriveFile;
  readonly folders: readonly DriveFile[];
  readonly documents: readonly DriveFile[];
}

/* ----------------------------------------------------------------------------
 * Adapter.
 * --------------------------------------------------------------------------*/

export interface DriveAdapterInput {
  readonly organizationId: string;
  readonly userId: string;
}

export interface DriveAdapterResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly errorCode?: "auth" | "unavailable" | "rate_limit" | "invalid_response" | "unsupported";
  readonly message?: string;
}

function ok<T>(value: T): DriveAdapterResult<T> {
  return { success: true, value };
}
function fail<T>(
  message: string,
  code: DriveAdapterResult<T>["errorCode"] = "invalid_response",
): DriveAdapterResult<T> {
  return { success: false, errorCode: code, message };
}

export class GoogleDriveAdapter {
  static readonly READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  static readonly WRITE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  static readonly FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
  static readonly GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";

  constructor(private readonly input: DriveAdapterInput) {}

  private async getAccessToken(requiredScope = GoogleDriveAdapter.READ_SCOPE): Promise<string | null> {
    const durable = await getGoogleTokenStore().get(
      this.input.organizationId,
      this.input.userId,
    );
    if (durable) {
      if (!hasGrantedScope(durable.scopes, requiredScope)) {
        return null;
      }
      if (new Date(durable.expiresAt).getTime() - 60_000 > Date.now()) {
        return durable.accessToken;
      }
      if (!durable.refreshToken) return null;
      try {
        const next = await refreshGoogleToken({
          refreshToken: durable.refreshToken,
          clientId: process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "",
          clientSecret: process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "",
        });
        await getGoogleTokenStore().put({
          ...durable,
          accessToken: next.accessToken,
          expiresAt: next.expiresAt,
          scopes: Array.from(new Set([...durable.scopes, ...next.scopes])),
        });
        return next.accessToken;
      } catch {
        return null;
      }
    }
    // Legacy in-memory fallback is retained for deterministic unit tests and
    // local development. Production always uses the durable row above.
    const tokens = gmailTokenStore.get(this.input.organizationId, this.input.userId);
    if (!tokens) return null;
    if (!hasGrantedScope(tokens.scopes, requiredScope)) return null;
    if (new Date(tokens.expiresAt).getTime() - 60_000 > Date.now()) {
      return tokens.accessToken;
    }
    try {
      const response = await googleApiFetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "",
          client_secret: process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "",
          refresh_token: tokens.refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!data.access_token) return null;
      const next = {
        ...tokens,
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
        scopes: (data.scope ?? tokens.scopes.join(" "))
          .split(/\s+/)
          .filter(Boolean),
      };
      gmailTokenStore.put(this.input.organizationId, this.input.userId, next);
      return next.accessToken;
    } catch {
      return null;
    }
  }

  async searchFiles(input: DriveSearchInput): Promise<DriveAdapterResult<readonly DriveFile[]>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return fail("Google no está conectado.", "auth");
    const sanitized = (input.query ?? "").replace(/[\r\n]/g, " ").trim();
    const clauses = ["trashed = false"];
    if (sanitized) clauses.push(`(name contains '${sanitized.replace(/'/g, "\\'")}' or fullText contains '${sanitized.replace(/'/g, "\\'")}')`);
    if (input.parentId) clauses.push(`'${input.parentId.replace(/'/g, "\\'")}' in parents`);
    if (input.mimeType) clauses.push(`mimeType = '${escapeDriveQuery(input.mimeType)}'`);
    if (clauses.length === 1) return fail("Búsqueda vacía.", "invalid_response");
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      pageSize: String(input.pageSize ?? 20),
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,owners(emailAddress))",
    });
    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      if (response.status === 429) return fail("Google aplicó rate limit.", "rate_limit");
      if (response.status >= 500) return fail("Google no responde.", "unavailable");
      return fail(`Google devolvió ${response.status}.`, "invalid_response");
    }
    const data = (await response.json()) as {
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        size?: string;
        modifiedTime?: string;
        webViewLink?: string;
        owners?: Array<{ emailAddress?: string }>;
      }>;
    };
    const files = (data.files ?? [])
      .filter((f): f is NonNullable<typeof f> & { id: string; name: string } =>
        Boolean(f.id) && Boolean(f.name),
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType ?? "application/octet-stream",
        ...(f.size ? { size: Number(f.size) } : {}),
        modifiedTime: f.modifiedTime ?? "",
        ...(f.webViewLink ? { webViewLink: f.webViewLink } : {}),
        ...(f.owners?.[0]?.emailAddress ? { ownerEmail: f.owners[0].emailAddress } : {}),
      }));
    return ok(files);
  }

  async listFiles(input: DriveListInput = {}): Promise<DriveAdapterResult<readonly DriveFile[]>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return fail("Google no está conectado.", "auth");
    const clauses = ["trashed = false"];
    if (input.mimeType) clauses.push(`mimeType = '${input.mimeType.replace(/'/g, "\\'")}'`);
    if (input.parentId) clauses.push(`'${input.parentId.replace(/'/g, "\\'")}' in parents`);
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      pageSize: String(input.pageSize ?? 100),
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,owners(emailAddress))",
    });
    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      if (response.status === 429) return fail("Google aplicó rate limit.", "rate_limit");
      if (response.status >= 500) return fail("Google no responde.", "unavailable");
      return fail(`Google devolvió ${response.status}.`, "invalid_response");
    }
    const data = (await response.json()) as { files?: DriveRawFile[] };
    return ok(normalizeDriveFiles(data.files ?? []));
  }

  /** Exact name lookup used by idempotent workspace creation. */
  async findFilesByName(input: {
    readonly name: string;
    readonly parentFolderId?: string;
    readonly mimeType?: string;
    readonly pageSize?: number;
  }): Promise<DriveAdapterResult<readonly DriveFile[]>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return fail("Google no está conectado.", "auth");
    const name = input.name.trim();
    if (!name) return fail("Nombre de archivo vacío.", "invalid_response");
    const clauses = [
      "trashed = false",
      `name = '${escapeDriveQuery(name)}'`,
    ];
    if (input.parentFolderId) clauses.push(`'${escapeDriveQuery(input.parentFolderId)}' in parents`);
    if (input.mimeType) clauses.push(`mimeType = '${escapeDriveQuery(input.mimeType)}'`);
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      pageSize: String(input.pageSize ?? 20),
      fields: driveFields(),
    });
    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return driveFailure(response.status, "No he podido buscar en Drive.");
    const data = (await response.json()) as { files?: DriveRawFile[] };
    return ok(normalizeDriveFiles(data.files ?? []));
  }

  async readFile(input: DriveReadInput): Promise<DriveAdapterResult<DriveFile>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return fail("Google no está conectado.", "auth");
    if (!input.fileId) return fail("ID de archivo vacío.", "invalid_response");
    const params = new URLSearchParams({
      fields: "id,name,mimeType,size,modifiedTime,webViewLink,owners(emailAddress)",
    });
    const meta = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!meta.ok) {
      if (meta.status === 401) return fail("Google rechazó la autorización.", "auth");
      return fail(`Google devolvió ${meta.status}.`, "invalid_response");
    }
    const data = (await meta.json()) as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
      parents?: string[];
      owners?: Array<{ emailAddress?: string }>;
    };
    const result: DriveFile = {
      id: data.id ?? input.fileId,
      name: data.name ?? "",
      mimeType: data.mimeType ?? "application/octet-stream",
      ...(data.size ? { size: Number(data.size) } : {}),
      modifiedTime: data.modifiedTime ?? "",
      ...(data.webViewLink ? { webViewLink: data.webViewLink } : {}),
      ...(data.owners?.[0]?.emailAddress ? { ownerEmail: data.owners[0].emailAddress } : {}),
    };
    const mimeType = result.mimeType;
    const isGoogleDoc = mimeType === "application/vnd.google-apps.document";
    const isPlainText = mimeType === "text/plain" || mimeType.startsWith("text/");
    const isPdf = mimeType === "application/pdf";
    if (isPdf) {
      return fail(
        "Este PDF está localizado, pero todavía no puedo extraer su texto de forma fiable.",
        "unsupported",
      );
    }
    if (!isGoogleDoc && !isPlainText) return ok(result);
    const contentUrl = isGoogleDoc
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/export?mimeType=text%2Fplain`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media`;
    const contentResponse = await googleApiFetch(contentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!contentResponse.ok) {
      if (contentResponse.status === 401) return fail("Google rechazó la autorización.", "auth");
      if (contentResponse.status >= 500) return fail("Google no responde.", "unavailable");
      return fail(`No he podido leer el contenido (${contentResponse.status}).`, "invalid_response");
    }
    const preview = (await contentResponse.text())
      .replace(new RegExp(String.fromCharCode(0), "g"), "")
      .slice(0, 12_000);
    return ok({ ...result, preview });
  }

  async createFolder(input: DriveCreateFolderInput): Promise<DriveAdapterResult<DriveFile>> {
    const name = input.name.trim();
    if (!name) return fail("Nombre de carpeta vacío.", "invalid_response");
    return this.createMetadataFile({
      name,
      mimeType: GoogleDriveAdapter.FOLDER_MIME_TYPE,
      ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
      ...(input.appProperties ? { appProperties: input.appProperties } : {}),
    });
  }

  async createFile(input: DriveCreateInput): Promise<DriveAdapterResult<DriveFile>> {
    const name = input.name.trim();
    if (!name) return fail("Nombre de archivo vacío.", "invalid_response");
    const mimeType = input.mimeType ?? "text/plain";
    if (mimeType === GoogleDriveAdapter.GOOGLE_DOC_MIME_TYPE) {
      return this.createGoogleDoc({
        name,
        ...(input.parentFolderId ? { parentFolderId: input.parentFolderId } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.appProperties ? { appProperties: input.appProperties } : {}),
      });
    }
    const accessToken = await this.getAccessToken(GoogleDriveAdapter.WRITE_SCOPE);
    if (!accessToken) return fail("Drive no tiene autorización de escritura.", "auth");
    const boundary = `departify_${Date.now().toString(36)}`;
    const metadata = JSON.stringify({
      name,
      mimeType,
      ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
      ...(input.appProperties ? { appProperties: input.appProperties } : {}),
    });
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      "",
      input.content ?? "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const response = await googleApiFetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent(driveFields())}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      return driveFailure(response.status, "Google no pudo crear el archivo.");
    }
    const data = (await response.json()) as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
      parents?: string[];
      owners?: Array<{ emailAddress?: string }>;
    };
    const result = {
      id: data.id ?? "",
      name: data.name ?? name,
      mimeType: data.mimeType ?? mimeType,
      ...(data.size ? { size: Number(data.size) } : {}),
      modifiedTime: data.modifiedTime ?? new Date().toISOString(),
      ...(data.webViewLink ? { webViewLink: data.webViewLink } : {}),
      ...(data.parents?.[0] ? { parent: data.parents[0], parents: data.parents } : {}),
      ...(data.owners?.[0]?.emailAddress ? { ownerEmail: data.owners[0].emailAddress } : {}),
    } satisfies DriveFile;
    if (!result.id) return fail("Google no ha confirmado el archivo.", "invalid_response");
    return ok(result);
  }

  async writeContent(input: DriveWriteInput): Promise<DriveAdapterResult<DriveFile>> {
    if (!input.fileId.trim()) return fail("ID de archivo vacío.", "invalid_response");
    if (input.mimeType === GoogleDriveAdapter.GOOGLE_DOC_MIME_TYPE) {
      return this.writeGoogleDocContent(input.fileId, input.content);
    }
    const accessToken = await this.getAccessToken(GoogleDriveAdapter.WRITE_SCOPE);
    if (!accessToken) return fail("Drive no tiene autorización de escritura.", "auth");
    const mimeType = input.mimeType ?? "text/plain";
    const response = await googleApiFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(input.fileId)}?uploadType=media&fields=${encodeURIComponent(driveFields())}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": mimeType,
        },
        body: input.content,
      },
    );
    if (!response.ok) return driveFailure(response.status, "Google no pudo actualizar el archivo.");
    const updated = normalizeDriveFile((await response.json()) as DriveRawFile);
    return updated ? ok(updated) : fail("Google no ha confirmado la actualización.", "invalid_response");
  }

  async createGoogleDoc(input: {
    readonly name: string;
    readonly parentFolderId?: string;
    readonly content?: string;
    readonly appProperties?: Readonly<Record<string, string>>;
  }): Promise<DriveAdapterResult<DriveFile>> {
    const name = input.name.trim();
    if (!name) return fail("Nombre de documento vacío.", "invalid_response");
    const created = await this.createMetadataFile({
      name,
      mimeType: GoogleDriveAdapter.GOOGLE_DOC_MIME_TYPE,
      ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
      ...(input.appProperties ? { appProperties: input.appProperties } : {}),
    });
    if (!created.success || !created.value || !input.content) return created;
    const written = await this.writeGoogleDocContent(created.value.id, input.content);
    if (!written.success) {
      return fail(
        "Google creó el documento, pero no pudo escribir su contenido.",
        written.errorCode ?? "invalid_response",
      );
    }
    return ok(written.value ?? created.value);
  }

  private async createMetadataFile(metadata: Readonly<Record<string, unknown>>): Promise<DriveAdapterResult<DriveFile>> {
    const accessToken = await this.getAccessToken(GoogleDriveAdapter.WRITE_SCOPE);
    if (!accessToken) return fail("Drive no tiene autorización de escritura.", "auth");
    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?fields=${encodeURIComponent(driveFields())}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!response.ok) return driveFailure(response.status, "Google no pudo crear el elemento.");
    const result = normalizeDriveFile((await response.json()) as DriveRawFile);
    return result ? ok(result) : fail("Google no ha confirmado el elemento.", "invalid_response");
  }

  private async writeGoogleDocContent(fileId: string, content: string): Promise<DriveAdapterResult<DriveFile>> {
    const accessToken = await this.getAccessToken(GoogleDriveAdapter.WRITE_SCOPE);
    if (!accessToken) return fail("Drive no tiene autorización de escritura.", "auth");
    const current = await googleApiFetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!current.ok) return driveFailure(current.status, "Google no pudo abrir el documento.");
    const document = (await current.json()) as { body?: { content?: Array<{ endIndex?: number }> } };
    const endIndex = document.body?.content?.at(-1)?.endIndex ?? 2;
    const requests: Array<Record<string, unknown>> = [];
    if (endIndex > 2) {
      requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
    }
    if (content) requests.push({ insertText: { location: { index: 1 }, text: content } });
    const update = await googleApiFetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );
    if (!update.ok) return driveFailure(update.status, "Google no pudo escribir el documento.");
    return this.readFile({ fileId });
  }

  /** Idempotently creates the real Departify folder tree and initial Docs. */
  async ensureDepartifyWorkspace(
    documents: readonly DriveWorkspaceDocument[] = [],
  ): Promise<DriveAdapterResult<DriveWorkspaceResult>> {
    const root = await this.ensureFolder("Departify");
    if (!root.success || !root.value) return propagateFailure(root);
    const names = [
      "01 — Empresa",
      "02 — Estrategia",
      "03 — Marketing",
      "04 — SEO",
      "05 — Branding",
      "06 — Ventas",
      "07 — Operaciones",
      "08 — Finanzas",
      "09 — Legal",
      "10 — Resultados",
    ];
    const folders: DriveFile[] = [];
    for (const name of names) {
      const folder = await this.ensureFolder(name, root.value.id);
      if (!folder.success || !folder.value) return propagateFailure(folder);
      folders.push(folder.value);
    }
    const createdDocuments: DriveFile[] = [];
    for (const document of documents) {
      const parent = folders.find((folder) => folder.name === document.parentFolderName);
      if (!parent) continue;
      const existing = await this.findFilesByName({
        name: document.name,
        parentFolderId: parent.id,
        mimeType: GoogleDriveAdapter.GOOGLE_DOC_MIME_TYPE,
      });
      if (!existing.success) return propagateFailure(existing);
      if (existing.value?.[0]) {
        createdDocuments.push(existing.value[0]);
        continue;
      }
      const created = await this.createGoogleDoc({
        name: document.name,
        parentFolderId: parent.id,
        content: document.content,
        appProperties: { departifyWorkspace: "v1" },
      });
      if (!created.success || !created.value) return propagateFailure(created);
      createdDocuments.push(created.value);
    }
    return ok({ root: root.value, folders, documents: createdDocuments });
  }

  private async ensureFolder(name: string, parentFolderId?: string): Promise<DriveAdapterResult<DriveFile>> {
    const existing = await this.findFilesByName({
      name,
      ...(parentFolderId ? { parentFolderId } : {}),
      mimeType: GoogleDriveAdapter.FOLDER_MIME_TYPE,
    });
    if (!existing.success) return propagateFailure(existing);
    if (existing.value?.[0]) return ok(existing.value[0]);
    return this.createFolder({
      name,
      ...(parentFolderId ? { parentFolderId } : {}),
      appProperties: { departifyWorkspace: "v1" },
    });
  }
}

interface DriveRawFile {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  owners?: Array<{ emailAddress?: string }>;
}

function normalizeDriveFiles(files: readonly DriveRawFile[]): readonly DriveFile[] {
  return files
    .map(normalizeDriveFile)
    .filter((file): file is DriveFile => Boolean(file));
}

function normalizeDriveFile(file: DriveRawFile): DriveFile | null {
  if (!file.id || !file.name) return null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? "application/octet-stream",
    ...(file.size ? { size: Number(file.size) } : {}),
    modifiedTime: file.modifiedTime ?? "",
    ...(file.webViewLink ? { webViewLink: file.webViewLink } : {}),
    ...(file.parents?.[0] ? { parent: file.parents[0], parents: file.parents } : {}),
    ...(file.owners?.[0]?.emailAddress ? { ownerEmail: file.owners[0].emailAddress } : {}),
  };
}

function driveFields(): string {
  return "id,name,mimeType,size,modifiedTime,webViewLink,parents,owners(emailAddress)";
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[\r\n]/g, " ");
}

function driveFailure<T>(status: number, fallback: string): DriveAdapterResult<T> {
  if (status === 401) return fail("Google rechazó la autorización.", "auth");
  if (status === 403) return fail("Drive necesita autorización adicional para esta acción.", "auth");
  if (status === 429) return fail("Google aplicó rate limit.", "rate_limit");
  if (status >= 500) return fail("Google no responde.", "unavailable");
  return fail(`${fallback} (${status}).`, "invalid_response");
}

function propagateFailure<T, U>(result: DriveAdapterResult<T>): DriveAdapterResult<U> {
  return {
    success: false,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.message ? { message: result.message } : {}),
  };
}
