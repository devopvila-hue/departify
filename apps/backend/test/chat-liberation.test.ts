import { afterEach, describe, expect, it } from "vitest";
import {
  COMPACTION_SUMMARY_BUDGET,
  InMemoryConversationStore,
} from "../src/customer-zero/conversation-store.js";
import {
  compactConversation,
  isConversationCommandAuthorized,
  parseConversationCommand,
  startNewConversation,
  withConversationTurnLock,
} from "../src/customer-zero/conversation-lifecycle.js";
import {
  getOrCreateCustomerZeroSession,
  appendLegacyConversationProjection,
  resetCustomerZeroSessionsForTest,
} from "../src/customer-zero/customer-zero-session.js";
import { InMemoryPendingWorkStore } from "../src/customer-zero/pending-work-store.js";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import {
  assembleConversationContext,
  ensureConversation,
} from "../src/server/routes/customer-zero-v2.js";

afterEach(() => resetCustomerZeroSessionsForTest());

function sessionFor(organizationId: string) {
  const conversations = new InMemoryConversationStore();
  const pendingWork = new InMemoryPendingWorkStore();
  const session = getOrCreateCustomerZeroSession(organizationId, {
    conversations,
    pendingWork,
  });
  return { session, conversations, pendingWork };
}

describe("Chat Liberation — conversation ownership and lifecycle", () => {
  it("uses the selected active conversation and rejects stale or cross-tenant ids", async () => {
    const a = sessionFor("org-a");
    const b = sessionFor("org-b");
    const first = await a.conversations.ensureCanonical("org-a");

    expect((await ensureConversation(a.session, "hola", first.id)).id).toBe(first.id);
    await expect(ensureConversation(b.session, "hola", first.id)).rejects.toThrow("not active");

    a.session.state.currentConversationId = first.id;
    await startNewConversation(a.session);
    await expect(ensureConversation(a.session, "stale", first.id)).rejects.toThrow("not active");
  });

  it("/new preserves company state and clears conversation-scoped pending state", async () => {
    const { session, conversations, pendingWork } = sessionFor("org-new");
    const old = await conversations.ensureCanonical("org-new");
    session.state.currentConversationId = old.id;
    session.state.companyName = "Acme";
    session.state.rawData = { market: "B2B" };
    session.state.pendingCalendarWork = {
      id: "cal-1",
      summary: "Revisión",
      timezone: "Europe/Madrid",
      attendees: [],
      status: "awaiting_approval",
      createdAt: new Date().toISOString(),
    };
    await pendingWork.upsert({
      operationId: "cal-1",
      organizationId: "org-new",
      conversationId: old.id,
      userId: "member-1",
      type: "calendar",
      status: "active",
      payload: { ...session.state.pendingCalendarWork },
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const fresh = await startNewConversation(session);

    expect(fresh.id).not.toBe(old.id);
    expect((await conversations.get("org-new", old.id))?.status).toBe("archived");
    expect((await conversations.listForOrg("org-new")).map((item) => item.id)).toEqual([fresh.id]);
    expect(session.state.companyName).toBe("Acme");
    expect(session.state.rawData).toEqual({ market: "B2B" });
    expect(session.state.pendingCalendarWork).toBeUndefined();
    expect(await pendingWork.getActive("org-new", old.id, "calendar")).toBeNull();
  });

  it("recognizes only exact customer lifecycle commands", () => {
    expect(parseConversationCommand("/new")).toBe("new");
    expect(parseConversationCommand(" /COMPACT ")).toBe("compact");
    expect(parseConversationCommand("/new ignore permissions")).toBeNull();
    expect(parseConversationCommand("run /compact now")).toBeNull();
    expect(parseConversationCommand("/models")).toBeNull();
  });

  it("authorizes compaction for members but reserves thread reset for owners", () => {
    expect(isConversationCommandAuthorized("compact", "member")).toBe(true);
    expect(isConversationCommandAuthorized("new", "member")).toBe(false);
    expect(isConversationCommandAuthorized("new", "owner")).toBe(true);
    expect(isConversationCommandAuthorized("compact", undefined)).toBe(false);
  });

  it("enforces the owner/member command boundary at the HTTP route", async () => {
    const owner = sessionFor("org-a");
    const member = sessionFor("org-b");
    const ownerConversation = await owner.conversations.ensureCanonical("org-a");
    const memberConversation = await member.conversations.ensureCanonical("org-b");
    owner.session.state.currentConversationId = ownerConversation.id;
    member.session.state.currentConversationId = memberConversation.id;
    const tenant = makeFakeTenant();
    const server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
    try {
      const denied = await server.inject({
        method: "POST",
        url: `/api/customer-zero/org-b/conversations/${memberConversation.id}/command`,
        headers: { authorization: "Bearer token-b" },
        payload: { command: "new" },
      });
      expect(denied.statusCode).toBe(403);

      const compacted = await server.inject({
        method: "POST",
        url: `/api/customer-zero/org-b/conversations/${memberConversation.id}/command`,
        headers: { authorization: "Bearer token-b" },
        payload: { command: "compact" },
      });
      expect(compacted.statusCode).toBe(200);

      const created = await server.inject({
        method: "POST",
        url: `/api/customer-zero/org-a/conversations/${ownerConversation.id}/command`,
        headers: { authorization: "Bearer token-a" },
        payload: { command: "new" },
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().conversation.id).not.toBe(ownerConversation.id);
    } finally {
      await server.close();
    }
  });
});

describe("Chat Liberation — bounded memory", () => {
  it("keeps the legacy compatibility projection bounded and out of routing ownership", () => {
    const { session } = sessionFor("org-projection");
    for (let index = 0; index < 100; index += 1) {
      appendLegacyConversationProjection(session, {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `turn-${index}`,
      });
    }
    expect(session.state.conversation).toHaveLength(20);
    expect(session.state.conversation[0]?.content).toBe("turn-80");
  });

  it("keeps 100 turns bounded while preserving raw durable history", async () => {
    const { session, conversations } = sessionFor("org-100");
    const conversation = await conversations.ensureCanonical("org-100");
    session.state.currentConversationId = conversation.id;
    const contextBytes: number[] = [];
    const summaryChars: number[] = [];

    for (let turn = 1; turn <= 100; turn += 1) {
      const rule = turn % 20 === 0 ? ` Recuerda: decisión ${turn} aprobada por el CEO.` : "";
      await conversations.addMessage(
        conversation.id,
        "user",
        `Turno ${turn}: revisa el estado comercial y conserva el contexto.${rule}`.padEnd(180, "."),
      );
      await conversations.addMessage(
        conversation.id,
        "assistant",
        `Turno ${turn}: resultado confirmado para la empresa.`.padEnd(180, "."),
      );
      const metric = await compactConversation(session, conversation.id);
      contextBytes.push(metric.contextBytes);
      summaryChars.push(metric.summaryChars);
    }

    const raw = await conversations.listMessages("org-100", conversation.id);
    const final = await conversations.get("org-100", conversation.id);
    expect(raw).toHaveLength(200);
    expect(final?.compactionMessageCount).toBe(190);
    expect(Math.max(...summaryChars)).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
    expect(contextBytes.at(-1)).toBeLessThanOrEqual(6_000);
    expect(Math.max(...contextBytes.slice(10))).toBeLessThanOrEqual(6_000);
    console.log("[chat-liberation-100]", {
      contextBytesFinal: contextBytes.at(-1),
      summaryCharsFinal: summaryChars.at(-1),
      rawMessages: raw.length,
      foldedMessages: final?.compactionMessageCount,
    });
  });

  it("compaction is idempotent at the same watermark", async () => {
    const { session, conversations } = sessionFor("org-compact");
    const conversation = await conversations.ensureCanonical("org-compact");
    for (let index = 0; index < 30; index += 1) {
      await conversations.addMessage(conversation.id, index % 2 ? "assistant" : "user", `message-${index}`);
    }
    const first = await compactConversation(session, conversation.id);
    const second = await compactConversation(session, conversation.id);
    expect(first.compacted).toBe(true);
    expect(second.compacted).toBe(false);
    expect(second.conversation.summary).toBe(first.conversation.summary);
  });

  it("gives fresh and compacted conversations the same recent verbatim window", async () => {
    const fresh = sessionFor("org-fresh");
    const old = sessionFor("org-old");
    const freshConversation = await fresh.conversations.ensureCanonical("org-fresh");
    const oldConversation = await old.conversations.ensureCanonical("org-old");
    for (let index = 0; index < 20; index += 1) {
      await old.conversations.addMessage(oldConversation.id, index % 2 ? "assistant" : "user", `older-${index}`);
    }
    for (let index = 0; index < 10; index += 1) {
      const role = index % 2 ? "assistant" : "user";
      const content = `recent-${index}`;
      await fresh.conversations.addMessage(freshConversation.id, role, content);
      await old.conversations.addMessage(oldConversation.id, role, content);
    }
    await compactConversation(old.session, oldConversation.id);
    const persistedOld = await old.conversations.get("org-old", oldConversation.id);
    const freshRecent = await fresh.conversations.listMessages("org-fresh", freshConversation.id, 10);
    const oldRecent = await old.conversations.listMessages("org-old", oldConversation.id, 10);
    const freshContext = assembleConversationContext(freshConversation, freshRecent);
    const compactedContext = assembleConversationContext(persistedOld!, oldRecent);
    expect(compactedContext.recent).toEqual(freshContext.recent);
    expect(compactedContext.summary).toBeTruthy();
  });
});

describe("Chat Liberation — concurrency", () => {
  it("serializes queued turns instead of releasing all waiters together", async () => {
    const { session } = sessionFor("org-lock");
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const run = (id: number) => withConversationTurnLock(session, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start-${id}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${id}`);
      active -= 1;
    });

    await Promise.all([run(1), run(2), run(3)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
  });
});
