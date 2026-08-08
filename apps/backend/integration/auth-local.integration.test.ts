/**
 * P0-A — real Supabase Auth integration test (LOCAL ONLY).
 *
 * Requires the local Supabase stack (with Auth enabled) running on
 * http://127.0.0.1:54321 and its start-secrets present. Not part of the
 * default `check`; run with: pnpm --filter @departify/backend test:integration
 *
 * Validates the real flow against real Supabase Auth + Postgres:
 *   signup → verified token → user id → owner membership → RLS isolation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { SupabaseTenantService } from "../src/auth/supabase-tenant-service.js";

const LOCAL_URL = "http://127.0.0.1:54321";
const PASSWORD = "departify-test-password";

const kongSecretPath = new URL(
  "../../../supabase/.temp/start-secrets/supabase_kong_departify/secret-0",
  import.meta.url,
);

function readLocalKeys(): { publishable: string; secret: string } {
  const kongConfig = readFileSync(kongSecretPath, "utf8");
  const publishable = kongConfig.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  const secret = kongConfig.match(/sb_secret_[A-Za-z0-9_-]+/)?.[0];
  if (!publishable || !secret) {
    throw new Error("Supabase local keys not found in start-secrets.");
  }
  return { publishable, secret };
}

function isLocalSupabaseUp(): boolean {
  try {
    readLocalKeys();
    return true;
  } catch {
    return false;
  }
}

const run = isLocalSupabaseUp() ? describe : describe.skip;

run("P0-A Supabase Auth + tenant access", () => {
  const keys = readLocalKeys();
  const tenant = new SupabaseTenantService({
    supabaseUrl: LOCAL_URL,
    supabaseAnonKey: keys.publishable,
    supabaseServiceRoleKey: keys.secret,
  });

  it("signs up a real user and establishes owner membership", async () => {
    const email = `p0a_${Date.now()}@departify.local`;
    const anon = createClient(LOCAL_URL, keys.publishable, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.auth.signUp({ email, password: PASSWORD });
    expect(error).toBeNull();
    const userId = data.user?.id;
    expect(userId).toBeTruthy();
    const token = data.session?.access_token;
    expect(token).toBeTruthy();

    const user = await tenant.verifyAccessToken(token!);
    expect(user.id).toBe(userId);

    const organization = await tenant.createOrganization(
      "MoOn Shared Living",
      user.id,
    );
    expect(organization.role).toBe("owner");

    const membership = await tenant.resolveMembership(
      user.id,
      organization.organizationId,
    );
    expect(membership?.role).toBe("owner");

    const orgs = await tenant.listForUser(user.id);
    expect(
      orgs.some((entry) => entry.organizationId === organization.organizationId),
    ).toBe(true);
  });

  it("enforces RLS: a user sees only organizations they belong to", async () => {
    // User A creates Org A.
    const emailA = `p0a_a_${Date.now()}@departify.local`;
    const anonA = createClient(LOCAL_URL, keys.publishable, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signupA = await anonA.auth.signUp({ email: emailA, password: PASSWORD });
    const userA = signupA.data.user;
    if (!userA) throw new Error("User A signup returned no user.");
    const orgA = await tenant.createOrganization("Org A", userA.id);

    // User B signs up; must NOT see Org A via RLS.
    const emailB = `p0a_b_${Date.now()}@departify.local`;
    const anonB = createClient(LOCAL_URL, keys.publishable, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signupB = await anonB.auth.signUp({ email: emailB, password: PASSWORD });
    const userB = signupB.data.user;
    const tokenB = signupB.data.session?.access_token;
    expect(userB?.id).toBeTruthy();
    expect(tokenB).toBeTruthy();

    const membership = await tenant.resolveMembership(userB!.id, orgA.organizationId);
    expect(membership).toBeNull();

    const response = await fetch(
      `${LOCAL_URL}/rest/v1/organizations?select=id,name`,
      {
        headers: {
          apikey: keys.publishable,
          Authorization: `Bearer ${tokenB}`,
        },
      },
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()) as { id: string }[];
    expect(rows.some((row) => row.id === orgA.organizationId)).toBe(false);
  });
});
