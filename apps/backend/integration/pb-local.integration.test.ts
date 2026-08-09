/**
 * Phase P-B — local Supabase integration (LOCAL ONLY).
 *
 * Validates the durable tool-state and conversation stores against real
 * Supabase: persistence, restart survival (re-read), and organization
 * isolation. Run with: pnpm --filter @departify/backend test:integration
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { SupabaseTenantService } from "../src/auth/supabase-tenant-service.js";
import { SupabaseToolStateStore } from "../src/customer-zero/supabase-tool-state-store.js";
import { SupabaseConversationStore } from "../src/customer-zero/supabase-conversation-store.js";

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

run("P-B durable tool state + conversations (local Supabase)", () => {
  const keys = readLocalKeys();
  const tenant = new SupabaseTenantService({
    supabaseUrl: LOCAL_URL,
    supabaseAnonKey: keys.publishable,
    supabaseServiceRoleKey: keys.secret,
  });
  const tools = new SupabaseToolStateStore({
    supabaseUrl: LOCAL_URL,
    supabaseAnonKey: keys.publishable,
    supabaseServiceRoleKey: keys.secret,
  });
  const conversations = new SupabaseConversationStore({
    supabaseUrl: LOCAL_URL,
    supabaseAnonKey: keys.publishable,
    supabaseServiceRoleKey: keys.secret,
  });

  async function createOrg(tag: string): Promise<string> {
    const email = `p0a_${tag}_${Date.now()}@departify.local`;
    const anon = createClient(LOCAL_URL, keys.publishable, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.auth.signUp({ email, password: PASSWORD });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error("signup returned no user");
    const organization = await tenant.createOrganization("MoOn", user.id);
    return organization.organizationId;
  }

  it("persists and re-reads a verified tool connection (restart survival + isolation)", async () => {
    const orgA = await createOrg("a");
    const orgB = await createOrg("b");

    await tools.upsert({
      organizationId: orgA,
      toolId: "mautic",
      label: "Mautic",
      capability: "crm.contacts",
      declared: true,
      status: "connected",
      configSource: "env:mautic",
      verifiedAt: new Date().toISOString(),
      health: "operational",
    });

    // Re-read from a FRESH store instance (simulates a new process).
    const freshTools = new SupabaseToolStateStore({
      supabaseUrl: LOCAL_URL,
      supabaseAnonKey: keys.publishable,
      supabaseServiceRoleKey: keys.secret,
    });
    const restored = await freshTools.get(orgA, "mautic");
    expect(restored?.status).toBe("connected");
    expect(restored?.verifiedAt).toBeTruthy();
    expect(restored?.configSource).toBe("env:mautic");

    // Organization isolation.
    expect(await freshTools.get(orgB, "mautic")).toBeNull();
    expect((await freshTools.listForOrg(orgB)).length).toBe(0);
  });

  it("persists conversations and messages and isolates them per organization", async () => {
    const orgA = await createOrg("ca");
    const orgB = await createOrg("cb");

    const conversation = await conversations.create(orgA, "Primeros 20 clientes");
    await conversations.addMessage(conversation.id, "user", "Quiero conseguir 20 clientes");
    await conversations.addMessage(conversation.id, "assistant", "Vamos a por ello.");

    const fresh = new SupabaseConversationStore({
      supabaseUrl: LOCAL_URL,
      supabaseAnonKey: keys.publishable,
      supabaseServiceRoleKey: keys.secret,
    });
    const restored = await fresh.get(orgA, conversation.id);
    expect(restored?.title).toBe("Primeros 20 clientes");
    const messages = await fresh.listMessages(orgA, conversation.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);

    // Organization isolation.
    expect(await fresh.get(orgB, conversation.id)).toBeNull();
    expect((await fresh.listForOrg(orgB)).length).toBe(0);

    // Archive is org-scoped and does not touch company state.
    expect(await fresh.archive(orgA, conversation.id)).toBe(true);
    expect(await fresh.archive(orgB, conversation.id)).toBe(false);
  });
});
