/** Provider-owned OAuth flows for Meta Business and TickTick. */

import { randomBytes } from "node:crypto";
import { getGoogleOAuthStateStore } from "./oauth-state.js";
import {
  getExternalOAuthTokenStore,
  type ExternalOAuthProvider,
  type ExternalOAuthTokenRecord,
} from "./external-oauth-tokens.js";

const EXTERNAL_OAUTH_TIMEOUT_MS = 15_000;
const META_API_VERSION = (process.env.META_GRAPH_API_VERSION ?? "v23.0").trim();

export const EXTERNAL_OAUTH_PROVIDERS: readonly ExternalOAuthProvider[] = [
  "meta_business",
  "ticktick",
];

export const META_SOCIAL_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const;

const TICKTICK_SCOPES = ["tasks:read", "tasks:write"] as const;

/** Provider-side revoke for Meta; local deletion remains authoritative if it fails. */
export async function revokeExternalProviderAccess(
  record: Pick<ExternalOAuthTokenRecord, "provider" | "accessToken">,
): Promise<boolean> {
  if (record.provider !== "meta_business" || !record.accessToken) return false;
  try {
    const response = await fetch(`https://graph.facebook.com/${META_API_VERSION}/me/permissions`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${record.accessToken}` },
      signal: AbortSignal.timeout(EXTERNAL_OAUTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function externalOAuthCredentials(provider: ExternalOAuthProvider): {
  clientId: string;
  clientSecret: string;
} | null {
  const names: readonly [string, string] = provider === "meta_business"
    ? ["META_APP_ID", "META_APP_SECRET"]
    : ["TICKTICK_CLIENT_ID", "TICKTICK_CLIENT_SECRET"];
  const clientId = process.env[names[0]]?.trim() ?? "";
  const clientSecret = process.env[names[1]]?.trim() ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function externalOAuthMissingCredentials(
  provider: ExternalOAuthProvider,
): string[] {
  const names: readonly [string, string] = provider === "meta_business"
    ? ["META_APP_ID", "META_APP_SECRET"]
    : ["TICKTICK_CLIENT_ID", "TICKTICK_CLIENT_SECRET"];
  return names.filter((name) => !(process.env[name]?.trim()));
}

export function externalOAuthRedirectUri(
  provider: ExternalOAuthProvider,
  publicBaseUrl?: string,
): string {
  const base = (
    publicBaseUrl?.trim() || process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${base}/connections/${provider}/callback`;
}

function providerConfig(provider: ExternalOAuthProvider, redirectUri: string) {
  if (provider === "meta_business") {
    return {
      authorizationEndpoint: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`,
      tokenEndpoint: `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`,
      scopes: META_SOCIAL_SCOPES,
      redirectUri,
    };
  }
  return {
    authorizationEndpoint: "https://ticktick.com/oauth/authorize",
    tokenEndpoint: "https://ticktick.com/oauth/token",
    scopes: TICKTICK_SCOPES,
    redirectUri,
  };
}

export async function startExternalOAuth(input: {
  organizationId: string;
  userId: string;
  provider: ExternalOAuthProvider;
  returnPath: string;
  redirectUri: string;
}): Promise<{ authorizationUrl: string; state: string }> {
  const credentials = externalOAuthCredentials(input.provider);
  if (!credentials) {
    throw new Error("EXTERNAL_OAUTH_NOT_CONFIGURED");
  }
  const config = providerConfig(input.provider, input.redirectUri);
  const state = randomBytes(24).toString("base64url");
  const now = new Date();
  await getGoogleOAuthStateStore().put({
    nonce: state,
    organizationId: input.organizationId,
    userId: input.userId,
    connectionIntent: "marketing",
    requestedToolId: input.provider,
    returnPath: input.returnPath,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  });
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
  });
  return {
    authorizationUrl: `${config.authorizationEndpoint}?${params.toString()}`,
    state,
  };
}

function providerError(provider: ExternalOAuthProvider, status: number): Error {
  return new Error(`${provider.toUpperCase()}_OAUTH_PROVIDER_${status}`);
}

async function readJson(response: Response, provider: ExternalOAuthProvider): Promise<Record<string, unknown>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw providerError(provider, response.status);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${provider.toUpperCase()}_OAUTH_INVALID_RESPONSE`);
  }
  return body as Record<string, unknown>;
}

function parseScopes(value: unknown, fallback: readonly string[]): string[] {
  if (typeof value === "string") return value.split(/[ ,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [...fallback];
}

async function exchangeMetaCode(
  code: string,
  credentials: { clientId: string; clientSecret: string },
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[] }> {
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?${params.toString()}`,
    { signal: AbortSignal.timeout(EXTERNAL_OAUTH_TIMEOUT_MS) },
  );
  const body = await readJson(response, "meta_business");
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("META_BUSINESS_MISSING_ACCESS_TOKEN");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  return {
    accessToken,
    refreshToken: null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    // Meta does not always echo the granted scopes. An absent scope response
    // must not be treated as consent for a write capability.
    scopes: parseScopes(body.scope, []),
  };
}

async function exchangeTickTickCode(
  code: string,
  credentials: { clientId: string; clientSecret: string },
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[] }> {
  const form = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    scope: TICKTICK_SCOPES.join(" "),
  });
  const response = await fetch("https://ticktick.com/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
    signal: AbortSignal.timeout(EXTERNAL_OAUTH_TIMEOUT_MS),
  });
  const body = await readJson(response, "ticktick");
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("TICKTICK_MISSING_ACCESS_TOKEN");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(body.scope, TICKTICK_SCOPES),
  };
}

interface MetaSocialAsset {
  readonly id: string;
  readonly name: string;
  readonly username?: string;
}

interface MetaProbe {
  readonly label: string;
  readonly scopes: string[];
  readonly facebookPages: readonly MetaSocialAsset[];
  readonly instagramAccounts: readonly MetaSocialAsset[];
}

function safeMetaAsset(value: unknown): MetaSocialAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) return null;
  const username = typeof record.username === "string" ? record.username.trim() : "";
  return username ? { id, name, username } : { id, name };
}

async function probeMeta(accessToken: string): Promise<MetaProbe> {
  const query = new URLSearchParams({ fields: "id,name", access_token: accessToken });
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/me?${query.toString()}`,
    { signal: AbortSignal.timeout(EXTERNAL_OAUTH_TIMEOUT_MS) },
  );
  const body = await readJson(response, "meta_business");
  const pagesQuery = new URLSearchParams({
    fields: "id,name,instagram_business_account{id,name,username}",
    limit: "100",
    access_token: accessToken,
  });
  const pagesResponse = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/me/accounts?${pagesQuery.toString()}`,
    { signal: AbortSignal.timeout(EXTERNAL_OAUTH_TIMEOUT_MS) },
  );
  const pagesBody = await readJson(pagesResponse, "meta_business") as { data?: unknown };
  const facebookPages: MetaSocialAsset[] = [];
  const instagramAccounts: MetaSocialAsset[] = [];
  if (Array.isArray(pagesBody.data)) {
    for (const entry of pagesBody.data) {
      const page = safeMetaAsset(entry);
      if (!page) continue;
      facebookPages.push(page);
      const instagram = entry && typeof entry === "object" && !Array.isArray(entry)
        ? safeMetaAsset((entry as Record<string, unknown>).instagram_business_account)
        : null;
      if (instagram) instagramAccounts.push(instagram);
    }
  }
  if (facebookPages.length === 0 && instagramAccounts.length === 0) {
    throw new Error("META_BUSINESS_NO_SOCIAL_ASSETS");
  }
  const identityLabel = typeof body.name === "string" ? body.name.trim() : "";
  const assetLabel = [
    facebookPages[0]?.name,
    instagramAccounts[0]?.username
      ? `@${instagramAccounts[0].username}`
      : instagramAccounts[0]?.name,
  ].filter(Boolean).join(" · ");
  return {
    label: assetLabel || identityLabel || "Meta Social",
    scopes: [],
    facebookPages,
    instagramAccounts,
  };
}

async function probeTickTick(accessToken: string): Promise<{ label: string; scopes: string[] }> {
  const response = await fetch("https://api.ticktick.com/open/v1/project", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(EXTERNAL_OAUTH_TIMEOUT_MS),
  });
  await readJson(response, "ticktick");
  return { label: "TickTick", scopes: [] };
}

export async function completeExternalOAuth(input: {
  organizationId: string;
  userId: string;
  provider: ExternalOAuthProvider;
  code: string;
  state: string;
  redirectUri: string;
}): Promise<{ record: ExternalOAuthTokenRecord; returnPath: string; grantedCapabilities: readonly string[] }> {
  const stateRecord = await getGoogleOAuthStateStore().get(input.state);
  if (!stateRecord || stateRecord.consumed) throw new Error("invalid_state");
  if (
    stateRecord.organizationId !== input.organizationId ||
    stateRecord.userId !== input.userId ||
    stateRecord.requestedToolId !== input.provider
  ) {
    throw new Error("org_or_user_mismatch");
  }
  await getGoogleOAuthStateStore().consume(input.state);
  const credentials = externalOAuthCredentials(input.provider);
  if (!credentials) throw new Error("EXTERNAL_OAUTH_NOT_CONFIGURED");

  const exchanged = input.provider === "meta_business"
    ? await exchangeMetaCode(input.code, credentials, input.redirectUri)
    : await exchangeTickTickCode(input.code, credentials, input.redirectUri);
  const metaProbe = input.provider === "meta_business"
    ? await probeMeta(exchanged.accessToken)
    : null;
  const probe = metaProbe ?? await probeTickTick(exchanged.accessToken);
  const record: ExternalOAuthTokenRecord = {
    organizationId: input.organizationId,
    userId: input.userId,
    provider: input.provider,
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresAt: exchanged.expiresAt,
    scopes: [...new Set([...exchanged.scopes, ...probe.scopes])],
    accountLabel: probe.label,
    operationalVerifiedAt: new Date().toISOString(),
    operationalProbeError: null,
  };
  await getExternalOAuthTokenStore().put(record);
  const grantedCapabilities = metaProbe
    ? [
        ...(metaProbe.facebookPages.length > 0 ? ["marketing.social.read"] : []),
        ...(metaProbe.facebookPages.length > 0 && exchanged.scopes.includes("pages_manage_posts")
          ? ["marketing.social.publish"]
          : []),
        ...(metaProbe.instagramAccounts.length > 0 ? ["marketing.social.instagram.read"] : []),
        ...(metaProbe.instagramAccounts.length > 0 && exchanged.scopes.includes("instagram_content_publish")
          ? ["marketing.social.instagram.publish"]
          : []),
      ]
    : ["tasks.read", "tasks.write"];
  return { record, returnPath: stateRecord.returnPath, grantedCapabilities };
}
