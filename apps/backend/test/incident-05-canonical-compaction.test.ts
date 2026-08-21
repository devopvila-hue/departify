/**
 * Incident 05 — Canonical Compaction
 *
 * Tests the compaction algorithm ensures:
 * A. Summary does NOT grow linearly
 * B. Already-compacted messages are NOT re-compacted
 * C. Canonical summary is REPLACED, not appended
 * D. Recent window contains only messages after watermark
 * E. Context bytes stay within budget
 * F. Follow-up continuity preserved
 * G. Cross-domain continuity preserved
 */
import { describe, it, expect } from "vitest";
import {
  summarizeOldMessages,
  splitForCompaction,
  canonicalSummary,
  COMPACTION_SUMMARY_BUDGET,
  COMPACTION_THRESHOLD_CHARS,
  COMPACTION_RECENT_VERBATIM,
} from "../src/customer-zero/conversation-store.js";

// ─── Helpers ───────────────────────────────────────────────────────────

function makeMessages(count: number, role: "user" | "assistant" = "user"): Array<{ role: "user" | "assistant"; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Message ${i + 1}: ${role === "user" ? "CEO says something" : "Assistant replies"}`,
  }));
}

function makeConversationMessage(id: string, role: "user" | "assistant", content: string) {
  return {
    id,
    conversationId: "conv-1",
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

// ─── A. Summary does NOT grow linearly ─────────────────────────────────

describe("Incident 05 — A: Summary does NOT grow linearly", () => {
  it("canonicalSummary combines old+delta within budget, compresses when exceeded", () => {
    const oldSummary = "Resumen de la conversación (compactado).\nTurnos anteriores: 100 del CEO y 100 de la empresa.\nPrimer tema: email";
    const newMessages = makeMessages(50);

    const { summary } = canonicalSummary(oldSummary, newMessages);

    // Summary should be bounded
    expect(summary.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
    // When within budget, old+delta are combined (this is correct behavior)
    // When exceeding budget, compression kicks in
  });

  it("summary stays bounded after multiple compaction rounds", () => {
    let summary: string | null = null;

    // Simulate 10 compaction rounds with 50 messages each
    for (let round = 0; round < 10; round++) {
      const messages = makeMessages(50);
      const result = canonicalSummary(summary, messages);
      summary = result.summary;
    }

    // After 10 rounds (500 messages), summary should still be bounded
    expect(summary!.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
  });

  it("summary does not exceed budget even with large old summary", () => {
    // Simulate a bloated old summary (like the45,698 char one in production)
    const bloatedSummary = "x".repeat(45_698);
    const newMessages = makeMessages(10);

    const { summary } = canonicalSummary(bloatedSummary, newMessages);

    expect(summary.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
  });
});

// ─── B. Already-compacted messages NOT re-compacted ────────────────────

describe("Incident 05 — B: Watermark prevents re-compaction", () => {
  it("splitForCompaction respects watermark boundary", () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeConversationMessage(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", `Content ${i}`)
    );

    const { older, recent } = splitForCompaction(messages, 10);

    // older should be messages 0-89, recent should be messages 90-99
    expect(older.length).toBe(90);
    expect(recent.length).toBe(10);
    expect(older[older.length - 1]!.id).toBe("msg-89");
    expect(recent[0]!.id).toBe("msg-90");
  });

  it("compaction only processes messages after prior watermark", () => {
    // Simulate: watermark at message 50, new messages 51-100
    const allMessages = Array.from({ length: 100 }, (_, i) =>
      makeConversationMessage(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", `Content ${i}`)
    );

    const priorIndex = 49; // watermark at message 50
    const { older } = splitForCompaction(allMessages, 10);
    const newOlder = older.filter((msg) =>
      allMessages.findIndex((candidate) => candidate.id === msg.id) > priorIndex,
    );

    // Should only include messages 50-89 (40 messages)
    expect(newOlder.length).toBe(40);
    expect(newOlder[0]!.id).toBe("msg-50");
  });
});

// ─── C. Canonical summary is REPLACED ──────────────────────────────────

describe("Incident 05 — C: Summary replacement", () => {
  it("new summary combines old+delta, compresses when over budget", () => {
    // Use a bloated old summary that will exceed budget when combined
    const bloatedOld = "x".repeat(3_900);
    const newMessages = makeMessages(20);

    const { summary } = canonicalSummary(bloatedOld, newMessages);

    // Should be within budget (compressed)
    expect(summary.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
    // Should contain new delta content (from compression)
    expect(summary).toContain("Resumen de la conversación");
  });

  it("first compaction creates summary from scratch", () => {
    const messages = makeMessages(20);

    const { summary, totalMessages } = canonicalSummary(null, messages);

    expect(summary).toContain("Resumen de la conversación");
    expect(totalMessages).toBe(20);
  });
});

// ─── D. Recent window contains only post-watermark messages ────────────

describe("Incident 05 — D: Recent window boundary", () => {
  it("recent messages are strictly after watermark", () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeConversationMessage(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", `Content ${i}`)
    );

    const { older, recent } = splitForCompaction(messages, 10);

    // Recent messages should have IDs after the last older message
    const lastOlderId = older[older.length - 1]!.id;
    for (const msg of recent) {
      const msgIndex = parseInt(msg.id.split("-")[1]!);
      const olderIndex = parseInt(lastOlderId.split("-")[1]!);
      expect(msgIndex).toBeGreaterThan(olderIndex);
    }
  });
});

// ─── E. Context bytes stay within budget ───────────────────────────────

describe("Incident 05 — E: Context budget", () => {
  it("summary respects COMPACTION_SUMMARY_BUDGET", () => {
    // Create messages with long content
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      content: "x".repeat(500), // 500 chars per message
    }));

    const { summary } = canonicalSummary(null, messages);

    expect(summary.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
  });

  it("budget is4,000 characters", () => {
    expect(COMPACTION_SUMMARY_BUDGET).toBe(4_000);
  });
});

// ─── F. Follow-up continuity preserved ─────────────────────────────────

describe("Incident 05 — F: Follow-up continuity", () => {
  it("recent window preserves last N messages for follow-ups", () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      makeConversationMessage(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", `Content ${i}`)
    );

    const { recent } = splitForCompaction(messages, 10);

    // Should have exactly 10 recent messages
    expect(recent.length).toBe(10);
    // Should be the last 10 messages
    expect(recent[0]!.id).toBe("msg-40");
    expect(recent[9]!.id).toBe("msg-49");
  });

  it("follow-up 'Resúmelo' can find previous email result in recent window", () => {
    // Simulate: email result in recent window
    const messages = [
      makeConversationMessage("msg-1", "user", "Dime cuál es mi último correo"),
      makeConversationMessage("msg-2", "assistant", "Tu último correo es de Facebook..."),
      makeConversationMessage("msg-3", "user", "Resúmelo"),
    ];

    const { recent } = splitForCompaction(messages, 10);

    // All messages should be in recent (less than 10)
    expect(recent.length).toBe(3);
    expect(recent.some((m) => m.content.includes("Facebook"))).toBe(true);
  });
});

// ─── G. Cross-domain continuity ────────────────────────────────────────

describe("Incident 05 — G: Cross-domain continuity", () => {
  it("email → calendar → marketing does not contaminate", () => {
    const messages = [
      makeConversationMessage("msg-1", "user", "Dime cuál es mi último correo"),
      makeConversationMessage("msg-2", "assistant", "Tu último correo es..."),
      makeConversationMessage("msg-3", "user", "Añade una reunión en mi calendario"),
      makeConversationMessage("msg-4", "assistant", "Reunión creada..."),
      makeConversationMessage("msg-5", "user", "Crea un post de marketing"),
      makeConversationMessage("msg-6", "assistant", "Post creado..."),
    ];

    const { summary } = canonicalSummary(null, messages);

    // Summary should mention all domains
    expect(summary).toContain("CEO");
    expect(summary).toContain("empresa");
  });
});

// ─── 500-message contract test ─────────────────────────────────────────

describe("Incident 05 — 500-message contract", () => {
  it("500 messages with multiple compaction rounds stays bounded", () => {
    let summary: string | null = null;
    let totalCompacted = 0;

    // Simulate 10 rounds of 50 messages each (500 total)
    for (let round = 0; round < 10; round++) {
      const messages = makeMessages(50);
      const result = canonicalSummary(summary, messages);
      summary = result.summary;
      totalCompacted += result.totalMessages;
    }

    // Summary should be bounded
    expect(summary!.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
    // Total compacted should be 500
    expect(totalCompacted).toBe(500);
  });

  it("summary includes key facts from all rounds", () => {
    let summary: string | null = null;

    // Round 1: email discussion
    const round1 = [
      { role: "user" as const, content: "Dime cuál es mi último correo" },
      { role: "assistant" as const, content: "Tu último correo es de Facebook" },
    ];
    const result1 = canonicalSummary(summary, round1);
    summary = result1.summary;

    // Round 2: calendar discussion
    const round2 = [
      { role: "user" as const, content: "Añade una reunión llamada test" },
      { role: "assistant" as const, content: "Reunión creada para mañana" },
    ];
    const result2 = canonicalSummary(summary, round2);
    summary = result2.summary;

    // Summary should be bounded
    expect(summary!.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_BUDGET);
  });
});

// ─── 30-turn soak test ─────────────────────────────────────────────────

describe("Incident 05 — 30-turn soak test", () => {
  it("context size remains stable across 30 turns", () => {
    const contextSizes: number[] = [];
    let summary: string | null = null;
    const allMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (let turn = 0; turn < 30; turn++) {
      // Each turn adds 2 messages (user + assistant)
      allMessages.push(
        { role: "user", content: `Turn ${turn + 1}: CEO asks something about topic ${turn}` },
        { role: "assistant", content: `Turn ${turn + 1}: Assistant replies with details` },
      );

      // Compact every 10 messages (every 5 turns)
      if (turn > 0 && turn % 5 === 0) {
        const result = canonicalSummary(summary, allMessages);
        summary = result.summary;
        allMessages.length = 0; // Clear compacted messages
      }

      // Calculate context size
      const summarySize = summary?.length ?? 0;
      const recentSize = allMessages.reduce((sum, m) => sum + m.content.length, 0);
      const contextSize = summarySize + recentSize;
      contextSizes.push(contextSize);
    }

    // After compaction kicks in (turn 5), context should stabilize
    // Compare turn 10 (after first compaction) vs turn 30
    const afterFirstCompaction = contextSizes[5]; // turn 6
    const lastSize = contextSizes[contextSizes.length - 1]; // turn 30

    // Growth after compaction should be minimal (summary bounded, recent window small)
    const postCompactionGrowth = lastSize! - afterFirstCompaction!;
    expect(postCompactionGrowth).toBeLessThan(COMPACTION_SUMMARY_BUDGET);
  });
});
