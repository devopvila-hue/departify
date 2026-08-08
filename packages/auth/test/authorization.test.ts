/**
 * P0-A — auth package deterministic tests.
 *
 * The framework-independent authorization boundary: token extraction,
 * server-side verification, and organization membership assertion.
 */
import { describe, expect, it } from "vitest";

import {
  assertOrganizationAccess,
  authenticateToken,
  AuthError,
  extractBearerToken,
  type AuthenticatedUser,
  type AuthService,
  type OrganizationMembership,
} from "../src/index.js";

const USER_A: AuthenticatedUser = { id: "user-a", email: "a@example.com" };
const USER_B: AuthenticatedUser = { id: "user-b", email: "b@example.com" };

class FakeAuthService implements AuthService {
  constructor(
    private readonly users: ReadonlyMap<string, AuthenticatedUser>,
    private readonly memberships: readonly OrganizationMembership[],
  ) {}

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = this.users.get(token);
    if (!user) {
      throw new AuthError("invalid_token", "invalid token");
    }
    return user;
  }

  async resolveMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.userId === userId &&
          membership.organizationId === organizationId,
      ) ?? null
    );
  }
}

function makeAuth() {
  const auth = new FakeAuthService(
    new Map([
      ["token-a", USER_A],
      ["token-b", USER_B],
    ]),
    [
      { organizationId: "org-a", userId: "user-a", role: "owner" },
      { organizationId: "org-b", userId: "user-b", role: "member" },
    ],
  );
  return auth;
}

describe("extractBearerToken", () => {
  it("extracts a well-formed Bearer token", () => {
    expect(extractBearerToken("Bearer abc.def")).toBe("abc.def");
  });

  it("is case-insensitive for the scheme", () => {
    expect(extractBearerToken("bearer abc")).toBe("abc");
  });

  it("rejects missing, non-Bearer and malformed headers", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer abc extra")).toBeNull();
  });
});

describe("authenticateToken", () => {
  it("throws 401 missing_token without a header", async () => {
    const auth = makeAuth();
    await expect(authenticateToken(auth, undefined)).rejects.toMatchObject({
      code: "missing_token",
      statusCode: 401,
    });
  });

  it("propagates invalid_token from the verifier", async () => {
    const auth = makeAuth();
    await expect(
      authenticateToken(auth, "Bearer nope"),
    ).rejects.toMatchObject({ code: "invalid_token", statusCode: 401 });
  });

  it("returns the verified user", async () => {
    const auth = makeAuth();
    await expect(authenticateToken(auth, "Bearer token-a")).resolves.toEqual(
      USER_A,
    );
  });
});

describe("assertOrganizationAccess", () => {
  it("allows a member of the organization", async () => {
    const auth = makeAuth();
    const context = await assertOrganizationAccess(
      auth,
      "Bearer token-a",
      "org-a",
    );
    expect(context.user.id).toBe("user-a");
    expect(context.organizationId).toBe("org-a");
    expect(context.membership.role).toBe("owner");
  });

  it("forbids a non-member (403)", async () => {
    const auth = makeAuth();
    await expect(
      assertOrganizationAccess(auth, "Bearer token-a", "org-b"),
    ).rejects.toMatchObject({ code: "forbidden", statusCode: 403 });
  });

  it("forbids a nonexistent organization without leaking existence (403)", async () => {
    const auth = makeAuth();
    await expect(
      assertOrganizationAccess(auth, "Bearer token-a", "org-unknown"),
    ).rejects.toMatchObject({ code: "forbidden", statusCode: 403 });
  });

  it("forbids without a token (401) before any membership lookup", async () => {
    const auth = makeAuth();
    await expect(
      assertOrganizationAccess(auth, undefined, "org-a"),
    ).rejects.toMatchObject({ code: "missing_token", statusCode: 401 });
  });
});
