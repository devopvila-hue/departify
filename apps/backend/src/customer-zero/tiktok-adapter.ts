import {
  getExternalOAuthTokenStore,
  type ExternalOAuthTokenRecord,
} from "./external-oauth-tokens.js";
import { externalOAuthCredentials } from "./external-oauth.js";

const TIKTOK_TIMEOUT_MS = 15_000;
const BUSINESS_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

export type TikTokReadKind = "profile" | "videos" | "campaigns" | "report";

export interface TikTokReadResult {
  readonly provider: "tiktok" | "tiktok_business";
  readonly kind: TikTokReadKind;
  readonly accountLabel: string;
  readonly accountCount?: number;
  readonly campaigns?: readonly {
    name: string;
    status: string;
  }[];
  readonly metrics?: Readonly<Record<string, string | number>>;
  readonly videos?: readonly {
    title: string;
    published: boolean;
  }[];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function businessData(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.code === "number" && body.code !== 0) {
    throw new Error(`TIKTOK_BUSINESS_API_${body.code}`);
  }
  return objectValue(body.data) ?? {};
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("TIKTOK_PROVIDER_UNAVAILABLE");
  }
  return body as Record<string, unknown>;
}

function expiresAtFromSeconds(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(Date.now() + value * 1000).toISOString()
    : null;
}

function shouldRefresh(record: ExternalOAuthTokenRecord): boolean {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt).getTime() <= Date.now() + 5 * 60 * 1000;
}

async function refreshLoginToken(record: ExternalOAuthTokenRecord): Promise<ExternalOAuthTokenRecord> {
  if (!record.refreshToken) throw new Error("TIKTOK_REAUTH_REQUIRED");
  const credentials = externalOAuthCredentials("tiktok");
  if (!credentials) throw new Error("TIKTOK_OAUTH_NOT_CONFIGURED");
  const form = new URLSearchParams({
    client_key: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "refresh_token",
    refresh_token: record.refreshToken,
  });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body: form,
    signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
  });
  const body = await jsonResponse(response);
  const data = objectValue(body.data) ?? body;
  const accessToken = safeText(data.access_token);
  if (!accessToken) throw new Error("TIKTOK_REAUTH_REQUIRED");
  const next: ExternalOAuthTokenRecord = {
    ...record,
    accessToken,
    refreshToken: safeText(data.refresh_token) || record.refreshToken,
    expiresAt: expiresAtFromSeconds(data.expires_in),
    refreshExpiresAt: expiresAtFromSeconds(data.refresh_expires_in) ?? record.refreshExpiresAt ?? null,
    scopes: typeof data.scope === "string"
      ? data.scope.split(/[ ,]+/).filter(Boolean)
      : record.scopes,
    operationalVerifiedAt: new Date().toISOString(),
    operationalProbeError: null,
  };
  await getExternalOAuthTokenStore().put(next);
  return next;
}

async function getToken(
  organizationId: string,
  userId: string,
  provider: "tiktok" | "tiktok_business",
): Promise<ExternalOAuthTokenRecord> {
  const record = await getExternalOAuthTokenStore().get(organizationId, userId, provider);
  if (!record) throw new Error("TIKTOK_NOT_CONNECTED");
  if (provider === "tiktok" && shouldRefresh(record)) return refreshLoginToken(record);
  return record;
}

async function businessGet(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params);
  const response = await fetch(`${BUSINESS_API_BASE}${path}?${query.toString()}`, {
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
  });
  return businessData(await jsonResponse(response));
}

function readBusinessList(data: Record<string, unknown>): readonly Record<string, unknown>[] {
  return Array.isArray(data.list)
    ? data.list.flatMap((item) => {
        const value = objectValue(item);
        return value ? [value] : [];
      })
    : [];
}

export function resolveTikTokReadKind(message: string): TikTokReadKind | null {
  const value = message.toLocaleLowerCase();
  if (!/tiktok|tik tok/.test(value)) return null;
  if (/publica|publicar|crear|crea|pausa|reanuda|presupuesto|audiencia|modifica|gestiona|write|create|pause|resume|budget/.test(value)) return null;
  if (/rendimiento|resultado|gasto|gastado|impresiones|clics|ctr|performance|spend|report/.test(value)) return "report";
  if (/campa[ñn]a|anuncio|ads|publicidad|campaign/.test(value)) return "campaigns";
  if (/v[ií]deo|contenido|publicaci[oó]n|post/.test(value)) return "videos";
  return "profile";
}

export class TikTokAdapter {
  async read(input: {
    organizationId: string;
    userId: string;
    kind: TikTokReadKind;
  }): Promise<TikTokReadResult> {
    if (input.kind === "profile" || input.kind === "videos") {
      const record = await getToken(input.organizationId, input.userId, "tiktok");
      if (input.kind === "profile") {
        const response = await fetch(
          "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,profile_deep_link,bio_description,is_verified,username,follower_count,following_count,likes_count,video_count",
          {
            headers: { authorization: `Bearer ${record.accessToken}` },
            signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
          },
        );
        const body = await jsonResponse(response);
        const user = objectValue(objectValue(body.data)?.user);
        const displayName = safeText(user?.display_name) || record.accountLabel || "TikTok";
        const metrics: Record<string, string | number> = {};
        for (const key of ["follower_count", "following_count", "likes_count", "video_count"]) {
          const value = user?.[key];
          if (typeof value === "number" || typeof value === "string") metrics[key] = value;
        }
        return {
          provider: "tiktok",
          kind: "profile",
          accountLabel: displayName,
          ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
        };
      }
      const response = await fetch(
        "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,embed_link",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${record.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ max_count: 20 }),
          signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
        },
      );
      const body = await jsonResponse(response);
      const list = Array.isArray(objectValue(body.data)?.videos)
        ? objectValue(body.data)?.videos as unknown[]
        : [];
      return {
        provider: "tiktok",
        kind: "videos",
        accountLabel: record.accountLabel ?? "TikTok",
        videos: list.flatMap((item) => {
          const video = objectValue(item);
          return video ? [{ title: safeText(video.title) || "Vídeo sin título", published: true }] : [];
        }),
      };
    }

    const record = await getToken(input.organizationId, input.userId, "tiktok_business");
    const advertiserId = record.selectedAccountRef ?? record.accountOptions?.[0]?.id;
    if (!advertiserId) throw new Error("TIKTOK_BUSINESS_NO_ADVERTISER_SELECTED");
    if (input.kind === "campaigns") {
      const data = await businessGet("/campaign/get/", record.accessToken, {
        advertiser_id: advertiserId,
        page: "1",
        page_size: "50",
      });
      const campaigns = readBusinessList(data).flatMap((item) => {
        const name = safeText(item.campaign_name) || safeText(item.name);
        if (!name) return [];
        return [{ name, status: safeText(item.operation_status) || safeText(item.status) || "" }];
      });
      return {
        provider: "tiktok_business",
        kind: "campaigns",
        accountLabel: record.accountLabel ?? "TikTok Ads",
        accountCount: record.accountOptions?.length ?? 1,
        campaigns,
      };
    }

    const now = new Date();
    const endDate = now.toISOString().slice(0, 10);
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const data = await businessGet("/report/integrated/get/", record.accessToken, {
      advertiser_id: advertiserId,
      service_type: "AUCTION",
      data_level: "AUCTION_ADVERTISER",
      report_type: "BASIC",
      dimensions: JSON.stringify(["stat_time_day"]),
      metrics: JSON.stringify(["spend", "impressions", "clicks", "ctr"]),
      start_date: startDate,
      end_date: endDate,
      page: "1",
      page_size: "50",
    });
    const rows = readBusinessList(data);
    const metrics: Record<string, string | number> = {};
    for (const row of rows) {
      const values = objectValue(row.metrics);
      if (!values) continue;
      for (const key of ["spend", "impressions", "clicks", "ctr"]) {
        const value = values[key];
        if (typeof value === "number" || typeof value === "string") metrics[key] = value;
      }
    }
    return {
      provider: "tiktok_business",
      kind: "report",
      accountLabel: record.accountLabel ?? "TikTok Ads",
      metrics,
    };
  }
}

export const tiktokAdapter = new TikTokAdapter();
