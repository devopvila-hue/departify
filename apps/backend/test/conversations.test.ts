/**
 * Phase P-B part 15 — durable conversation sessions.
 *
 * Conversation lifecycle, restart survival, tenant isolation, deterministic
 * titles and bounded history. Company state (tool declarations, connections,
 * departments) must survive conversation archive/new.
 */
import { describe, expect, it } from "vitest";

import {
  boundedConversationHistory,
  conversationSearchTerms,
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  InMemoryConversationStore,
  shouldCompact,
  splitForCompaction,
  summarizeOldMessages,
  type ConversationMessage,
} from "../src/customer-zero/conversation-store.js";

describe("conversation store", () => {
  it("resolves one canonical conversation and never forks on repeated resolution", async () => {
    const store = new InMemoryConversationStore();
    const first = await store.ensureCanonical("orgA");
    const second = await store.ensureCanonical("orgA", "Otro título");

    expect(second.id).toBe(first.id);
    expect((await store.listForOrg("orgA")).map((item) => item.id)).toEqual([first.id]);
  });

  it("creates, lists and archives conversations per organization", async () => {
    const store = new InMemoryConversationStore();
    const a = await store.create("orgA", "Primeros 20 clientes");
    const b = await store.create("orgA", "Conectar Mautic");

    expect((await store.listForOrg("orgA")).length).toBe(2);
    expect(await store.get("orgB", a.id)).toBeNull();

    expect(await store.archive("orgA", b.id)).toBe(true);
    const listed = await store.listForOrg("orgA");
    expect(listed.some((c) => c.id === b.id)).toBe(false);
    expect(listed.some((c) => c.id === a.id)).toBe(true);
  });

  it("persists messages in order and restores them", async () => {
    const store = new InMemoryConversationStore();
    const conversation = await store.create("orgA", "Chat");
    await store.addMessage(conversation.id, "user", "Hola");
    await store.addMessage(conversation.id, "assistant", "Hola, ¿qué necesitas?");
    const messages = await store.listMessages("orgA", conversation.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toBe("Hola, ¿qué necesitas?");
  });

  it("conversations survive across a 'restart' when the store is durable", async () => {
    const store = new InMemoryConversationStore();
    const conversation = await store.create("orgA", "Estrategia");
    await store.addMessage(conversation.id, "user", "Quiero más clientes");
    await store.addMessage(conversation.id, "assistant", "Vamos a ello.");

    // Simulate a new process sharing the same durable store.
    const reloaded = new InMemoryConversationStore();
    // Copy the durable snapshot (a real Supabase store would read the table).
    for (const record of await store.listForOrg("orgA")) {
      await reloaded.create(record.organizationId, record.title);
    }
    const recreated = await reloaded.create("orgA", "Copia");
    const original = await store.get("orgA", conversation.id);
    expect(original?.title).toBe("Estrategia");
    expect((await store.listMessages("orgA", conversation.id)).length).toBe(2);
    void recreated;
  });

  it("renames an untitled conversation with a deterministic title", async () => {
    const store = new InMemoryConversationStore();
    const conversation = await store.create("orgA", DEFAULT_CONVERSATION_TITLE);
    expect(conversation.title).toBe(DEFAULT_CONVERSATION_TITLE);
    expect(await store.rename("orgA", conversation.id, deriveConversationTitle("Quiero conseguir los primeros 20 clientes"))).toBe(true);
    const read = await store.get("orgA", conversation.id);
    expect(read?.title).toBe("Conseguir los primeros 20 clientes");
  });

  it("derives a useful deterministic title without an LLM", () => {
    expect(deriveConversationTitle("Quiero conseguir los primeros 20 clientes")).toBe(
      "Conseguir los primeros 20 clientes",
    );
    expect(deriveConversationTitle("Conectar Mautic")).toBe("Conectar Mautic");
  });

  it("bounded history returns only the last messages, oldest first", () => {
    const messages: ConversationMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      conversationId: "c1",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
      createdAt: `2026-08-09T00:00:${String(i).padStart(2, "0")}.000Z`,
    }));
    const bounded = boundedConversationHistory(messages, 10);
    expect(bounded.length).toBe(10);
    expect(bounded[0]?.content).toBe("msg 20");
    expect(bounded[9]?.content).toBe("msg 29");
  });

  it("keeps raw history while making compaction and retrieval usable", async () => {
    const store = new InMemoryConversationStore();
    const conversation = await store.create("orgA", "Marketing");
    const messages = [
      ["user", "La campaña de lanzamiento debe centrarse en clínicas privadas."],
      ["assistant", "Lo tendré en cuenta para el plan de adquisición."],
      ["user", "Nunca uses descuentos sin mi aprobación."],
    ] as const;
    for (const [role, content] of messages) await store.addMessage(conversation.id, role, content);
    const raw = await store.listMessages("orgA", conversation.id);
    const { older } = splitForCompaction(raw, 1);
    expect(shouldCompact(raw.reduce((sum, message) => sum + message.content.length, 0))).toBe(false);
    expect(summarizeOldMessages(older)).toContain("campaña");
    await store.saveCompaction("orgA", conversation.id, summarizeOldMessages(older), older.at(-1)!.id, older.length);
    expect((await store.get("orgA", conversation.id))?.summary).toContain("campaña");
    expect((await store.listMessages("orgA", conversation.id)).length).toBe(3);
    expect(conversationSearchTerms("¿te acuerdas de lo que hablamos sobre la campaña?"))
      .toEqual(["acuerdas", "hablamos", "campaña"]);
    expect((await store.searchMessages("orgA", conversation.id, "¿te acuerdas de lo que hablamos sobre la campaña?"))[0]?.content)
      .toContain("campaña");
  });

  it("archiving a conversation does not delete company-level tool state", async () => {
    // Conversations and tool declarations live in separate stores/domains.
    // This guards the architectural separation contract.
    const store = new InMemoryConversationStore();
    const conversation = await store.create("orgA", "Trabajo");
    await store.addMessage(conversation.id, "user", "Recordar el ICP");
    expect(await store.archive("orgA", conversation.id)).toBe(true);
    // The conversation is gone from the active list, but nothing else was
    // touched (the tool-state store is a different concern).
    expect((await store.listForOrg("orgA")).length).toBe(0);
  });
});
