/**
 * Auth error taxonomy — Phase P0-A.
 *
 * The error codes map to HTTP status codes at the transport boundary:
 *   - missing/invalid/expired token → 401
 *   - forbidden (no membership)     → 403
 *
 * Responses built from these codes must stay generic: never leak whether an
 * organization exists or what the caller is missing.
 */

export type AuthErrorCode =
  | "missing_token"
  | "invalid_token"
  | "expired_token"
  | "forbidden";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly statusCode: number;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = code === "forbidden" ? 403 : 401;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
