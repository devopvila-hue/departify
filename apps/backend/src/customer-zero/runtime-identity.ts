import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const DEFAULT_AUDIENCE = "departify-tool-gateway";
const DEFAULT_TTL_SECONDS = 60;

export interface RuntimeTokenClaims {
  readonly sub: string;
  readonly aud: string;
  readonly organizationId: string;
  readonly sessionKey: string;
  readonly agentId: string;
  readonly iat: number;
  readonly exp: number;
}

export interface RuntimeTokenValidation {
  readonly valid: boolean;
  readonly reason?: string;
  readonly claims?: RuntimeTokenClaims;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signature(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueScopedRuntimeToken(input: {
  readonly secret: string;
  readonly organizationId: string;
  readonly sessionKey: string;
  readonly agentId?: string;
  readonly nowSeconds?: number;
  readonly ttlSeconds?: number;
  readonly audience?: string;
}): { token: string; claims: RuntimeTokenClaims } {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: RuntimeTokenClaims = {
    sub: "openclaw-native-tool",
    aud: input.audience ?? DEFAULT_AUDIENCE,
    organizationId: input.organizationId,
    sessionKey: input.sessionKey,
    agentId: input.agentId ?? "main",
    iat: now,
    exp: now + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const payload = encode(JSON.stringify(claims));
  return {
    token: `${TOKEN_VERSION}.${payload}.${signature(input.secret, payload)}`,
    claims,
  };
}

export function validateScopedRuntimeToken(input: {
  readonly token: string;
  readonly secret: string;
  readonly expectedAudience?: string;
  readonly nowSeconds?: number;
}): RuntimeTokenValidation {
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { valid: false, reason: "invalid_format" };
  }
  const payload = parts[1]!;
  const actual = parts[2]!;
  const expected = signature(input.secret, payload);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (
    expectedBytes.length !== actualBytes.length ||
    !timingSafeEqual(expectedBytes, actualBytes)
  ) {
    return { valid: false, reason: "invalid_signature" };
  }
  const decoded = decode(payload);
  if (!decoded) return { valid: false, reason: "invalid_payload" };
  let claims: RuntimeTokenClaims;
  try {
    claims = JSON.parse(decoded) as RuntimeTokenClaims;
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    claims.sub !== "openclaw-native-tool" ||
    claims.aud !== (input.expectedAudience ?? DEFAULT_AUDIENCE) ||
    !claims.organizationId ||
    !claims.sessionKey ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    claims.iat > now + 30
  ) {
    return { valid: false, reason: "invalid_claims" };
  }
  return { valid: true, claims };
}

/**
 * The only accepted OpenClaw identity for a CEO conversation. The model can
 * never choose this value: it is supplied by OpenClaw's trusted tool context.
 */
export function organizationFromOpenClawSessionKey(
  sessionKey: string,
): { organizationId: string; agentId: string } | null {
  const match = /^departify:ceo:([^:]+)$/.exec(sessionKey.trim());
  if (!match?.[1]) return null;
  return { organizationId: match[1], agentId: "main" };
}

export function runtimeTokenSecret(): string | null {
  const value = process.env.DEPARTIFY_RUNTIME_TOKEN?.trim();
  return value ? value : null;
}

export { DEFAULT_AUDIENCE };
