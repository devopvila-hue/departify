import { describe, expect, it, vi, beforeEach } from "vitest";
import type { InboxItem } from "../src/customer-zero/inbox-domain.js";

/**
 * CZ03 — durable inbox persistence boundary.
 *
 * The SupabaseInboxStore maps InboxItem ↔ `inbox_items` rows (org-scoped,
 * deduplicated by (organization_id, source, source_message_id), RLS via
 * membership for authenticated reads, service_role for the backend). This
 * unit test pins the mapping with a mocked Supabase client; the real project
 * is exercised through the integration suite / production.
 */

// A mutable mock client factory: each test sets `mockClient.from` behavior.
let mockFrom: ((table: string) => unknown) | undefined;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (!mockFrom) throw new Error("mockFrom not set");
      return mockFrom(table);
    },
  }),
}));

import { SupabaseInboxStore } from "../src/customer-zero/supabase-inbox-store.js";

const authConfig = {
  supabaseUrl: "https://test.supabase.co",
  supabaseAnonKey: "anon",
  supabaseServiceRoleKey: "service-role",
};

function makeItem(overrides: Partial<Omit<InboxItem, "id" | "createdAt" | "updatedAt">> = {}) {
  return {
    organizationId: "org-a",
    source: "gmail",
    sourceMessageId: "msg_1",
    channel: "email" as const,
    category: "lead" as const,
    subject: "Consulta pricing",
    sender: { email: "cliente@example.com", displayName: "Cliente" },
    recipients: [{ email: "ceo@departify.app" }],
    plainText: "Me interesa vuestro servicio",
    preview: "Me interesa vuestro servicio",
    receivedAt: "2026-08-01T10:00:00Z",
    unread: true,
    importance: 0.85,
    departmentId: "marketing",
    isLead: true,
    relatedWorkItemId: null,
    relatedConversationId: null,
    provenance: { provider: "gmail", rawEventId: "msg_1" },
    state: "classified" as const,
    ...overrides,
  };
}

const row = {
  id: "inbox-1",
  organization_id: "org-a",
  source: "gmail",
  source_message_id: "msg_1",
  source_thread_id: null,
  channel: "email",
  category: "lead",
  subject: "Consulta pricing",
  sender_email: "cliente@example.com",
  sender_name: "Cliente",
  recipients: [],
  plain_text: "Me interesa vuestro servicio",
  preview: "Me interesa vuestro servicio",
  received_at: "2026-08-01T10:00:00Z",
  unread: true,
  importance: 0.85,
  department_id: "marketing",
  is_lead: true,
  related_work_item_id: null,
  related_conversation_id: null,
  provenance: { provider: "gmail" },
  state: "classified",
  created_at: "2026-08-01T10:00:01Z",
  updated_at: "2026-08-01T10:00:01Z",
};

describe("SupabaseInboxStore — persistence mapping", () => {
  beforeEach(() => {
    mockFrom = undefined;
  });

  it("upsert writes an org-scoped row and maps it back to an InboxItem", async () => {
    mockFrom = () => ({
      upsert: () => ({
        select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
    });
    const store = new SupabaseInboxStore(authConfig);
    const saved = await store.upsert(makeItem());
    expect(saved.id).toBe("inbox-1");
    expect(saved.organizationId).toBe("org-a");
    expect(saved.sender.email).toBe("cliente@example.com");
    expect(saved.importance).toBe(0.85);
    expect(saved.category).toBe("lead");
  });

  it("list pins the organization and maps rows back", async () => {
    const seen: string[] = [];
    const mk = () =>
      new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") return undefined;
            seen.push(prop);
            if (prop === "limit") {
              return async () => ({ data: [row], error: null });
            }
            // select / eq / order are chainable functions returning the next
            // link in the chain.
            return () => mk();
          },
        },
      );
    mockFrom = () => mk();
    const store = new SupabaseInboxStore(authConfig);
    const items = await store.list({ organizationId: "org-a" });
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe("inbox-1");
    expect(items[0]?.organizationId).toBe("org-a");
    expect(items[0]?.sender.email).toBe("cliente@example.com");
    expect(items[0]?.category).toBe("lead");
    // The query chain is org-scoped: it must include an .eq() filter.
    expect(seen).toContain("eq");
  });

  it("setState updates the row and maps it back", async () => {
    mockFrom = () => ({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      }),
    });
    const store = new SupabaseInboxStore(authConfig);
    const updated = await store.setState("inbox-1", "in_work");
    expect(updated.state).toBe("classified");
    expect(updated.organizationId).toBe("org-a");
  });

  it("get returns null when no row exists", async () => {
    mockFrom = () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    const store = new SupabaseInboxStore(authConfig);
    const found = await store.get("missing");
    expect(found).toBeNull();
  });
});
