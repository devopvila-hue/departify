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
  readonly ownerEmail?: string;
  readonly preview?: string;
}

export interface DriveSearchInput {
  readonly query: string;
  readonly pageSize?: number;
}

export interface DriveReadInput {
  readonly fileId: string;
}

export interface DriveCreateInput {
  readonly name: string;
  readonly mimeType?: string;
  readonly content?: string;
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
  readonly errorCode?: "auth" | "unavailable" | "rate_limit" | "invalid_response";
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
  constructor(private readonly input: DriveAdapterInput) {}

  private async getAccessToken(): Promise<string | null> {
    const tokens = gmailTokenStore.get(this.input.organizationId, this.input.userId);
    if (!tokens) return null;
    if (new Date(tokens.expiresAt).getTime() - 60_000 > Date.now()) {
      return tokens.accessToken;
    }
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
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
    const sanitized = input.query.replace(/[\r\n]/g, " ").trim();
    if (sanitized.length === 0) return fail("Búsqueda vacía.", "invalid_response");
    const params = new URLSearchParams({
      q: `name contains '${sanitized.replace(/'/g, "\\'")}' or fullText contains '${sanitized.replace(/'/g, "\\'")}'`,
      pageSize: String(input.pageSize ?? 20),
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,owners(emailAddress))",
    });
    const response = await fetch(
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

  async readFile(input: DriveReadInput): Promise<DriveAdapterResult<DriveFile>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return fail("Google no está conectado.", "auth");
    if (!input.fileId) return fail("ID de archivo vacío.", "invalid_response");
    const params = new URLSearchParams({
      fields: "id,name,mimeType,size,modifiedTime,webViewLink,owners(emailAddress)",
    });
    const meta = await fetch(
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
    return ok(result);
  }

  async createFile(input: DriveCreateInput): Promise<DriveAdapterResult<DriveFile>> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return fail("Google no está conectado.", "auth");
    const name = input.name.trim();
    if (!name) return fail("Nombre de archivo vacío.", "invalid_response");
    const mimeType = input.mimeType ?? "text/plain";
    const boundary = `departify_${Date.now().toString(36)}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const metadata = JSON.stringify({ name, mimeType });
    const body = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}${delimiter}Content-Type: ${mimeType}\r\n\r\n${input.content ?? ""}${closeDelim}`;
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,owners(emailAddress)",
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
      return fail(`Google no creó el archivo (${response.status}).`, "invalid_response");
    }
    const data = (await response.json()) as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
      owners?: Array<{ emailAddress?: string }>;
    };
    return ok({
      id: data.id ?? "",
      name: data.name ?? name,
      mimeType: data.mimeType ?? mimeType,
      ...(data.size ? { size: Number(data.size) } : {}),
      modifiedTime: data.modifiedTime ?? new Date().toISOString(),
      ...(data.webViewLink ? { webViewLink: data.webViewLink } : {}),
      ...(data.owners?.[0]?.emailAddress ? { ownerEmail: data.owners[0].emailAddress } : {}),
    });
  }
}
