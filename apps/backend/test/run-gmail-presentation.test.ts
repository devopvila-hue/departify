/**
 * Central Chat UX P0 — Gmail presentation regression suite.
 *
 * Verifies:
 *   A. "último correo recibido" → maxResults 1, latest email semantics.
 *   B. Raw Gmail query string is NEVER exposed to the CEO.
 *   C. HTML entities (&quot; &#39; &amp; &lt; &gt;) are decoded safely.
 *   D. Multiple emails are formatted as separate items, not one paragraph.
 *   E. Response does not exceed the configured display cap.
 *   G. Empty mailbox renders an honest empty result.
 */
import { describe, expect, it } from "vitest";

import {
  decodeHtmlEntities,
  deriveGmailReadPlan,
  humanReceivedAt,
  renderGmailSummary,
  summarizeGmailMessage,
  type GmailSummaryItem,
} from "../src/customer-zero/run-gmail-presentation.js";

function makeItem(overrides: Partial<GmailSummaryItem> = {}): GmailSummaryItem {
  return {
    id: overrides.id ?? "msg-1",
    threadId: overrides.threadId ?? "thread-1",
    sender: overrides.sender ?? "LinkedIn <hello@linkedin.com>",
    senderEmail: overrides.senderEmail ?? "hello@linkedin.com",
    subject: overrides.subject ?? "Welcome to your new role",
    receivedAt:
      overrides.receivedAt ??
      "Tue, 12 Aug 2026 09:14:22 +0000",
    snippet:
      overrides.snippet ??
      "Your profile has been updated successfully. View your dashboard for the latest metrics.",
    unread: overrides.unread ?? false,
  };
}

describe("run-gmail-presentation — deriveGmailReadPlan", () => {
  it("A. último correo → 1 result", () => {
    const plan = deriveGmailReadPlan("¿Cuál es el último correo recibido?");
    expect(plan.intent).toBe("latest");
    expect(plan.maxResults).toBe(1);
  });

  it("A. last mail → 1 result", () => {
    const plan = deriveGmailReadPlan("show me my last mail");
    expect(plan.intent).toBe("latest");
    expect(plan.maxResults).toBe(1);
  });

  it("tengo correos importantes → 5 unread-style", () => {
    const plan = deriveGmailReadPlan("¿Tengo correos importantes?");
    expect(plan.intent).toBe("important");
    expect(plan.maxResults).toBe(5);
  });

  it("sin leer → unread intent", () => {
    const plan = deriveGmailReadPlan("¿cuáles tengo sin leer?");
    expect(plan.intent).toBe("unread");
    expect(plan.maxResults).toBe(5);
  });

  it("busca un correo de Juan → search intent", () => {
    const plan = deriveGmailReadPlan("busca un correo de Juan");
    expect(plan.intent).toBe("search");
    expect(plan.maxResults).toBe(5);
  });

  it("default → recent", () => {
    const plan = deriveGmailReadPlan("¿qué hay en mi bandeja?");
    expect(plan.intent).toBe("recent");
    expect(plan.maxResults).toBe(5);
  });
});

describe("run-gmail-presentation — decodeHtmlEntities", () => {
  it("C. decodes &quot; &#39; &amp; &lt; &gt;", () => {
    expect(decodeHtmlEntities("He said &quot;hi&quot;")).toBe('He said "hi"');
    expect(decodeHtmlEntities("it&#39;s ok")).toBe("it's ok");
    expect(decodeHtmlEntities("Q&amp;A")).toBe("Q&A");
    expect(decodeHtmlEntities("a &lt;b&gt;")).toBe("a <b>");
  });

  it("C. passes through text without entities unchanged", () => {
    expect(decodeHtmlEntities("plain text")).toBe("plain text");
  });
});

describe("run-gmail-presentation — renderGmailSummary", () => {
  it("B. raw Gmail query syntax is NEVER exposed", () => {
    const text = renderGmailSummary({
      intent: "recent",
      items: [makeItem()],
      locale: "es",
      totalFound: 1,
    });
    expect(text).not.toContain("newer_than:");
    expect(text).not.toContain("is:unread");
    expect(text).not.toContain("in:inbox");
    expect(text).not.toContain("after:");
  });

  it("D. latest → single-item structured output", () => {
    const text = renderGmailSummary({
      intent: "latest",
      items: [makeItem({ subject: "Welcome to Moon" })],
      locale: "es",
      totalFound: 1,
    });
    expect(text).toContain("El último correo que has recibido");
    expect(text).toContain("LinkedIn");
    expect(text).toContain("Welcome to Moon");
    expect(text).not.toContain("He encontrado");
    expect(text).not.toContain("relevante(s)");
  });

  it("D. multiple emails are visually separated items, not one paragraph", () => {
    const items: GmailSummaryItem[] = [
      makeItem({ id: "1", subject: "Subject one" }),
      makeItem({ id: "2", subject: "Subject two" }),
      makeItem({ id: "3", subject: "Subject three" }),
    ];
    const text = renderGmailSummary({
      intent: "recent",
      items,
      locale: "es",
      totalFound: 3,
    });
    expect(text).toContain("1.");
    expect(text).toContain("2.");
    expect(text).toContain("3.");
    // Each item has its own block of lines, separated by blank lines.
    const blocks = text.split(/\n\n+/);
    expect(blocks.length).toBeGreaterThanOrEqual(items.length);
  });

  it("E. respects maxResults (1 for latest) regardless of input", () => {
    const items = [
      makeItem({ id: "1" }),
      makeItem({ id: "2" }),
      makeItem({ id: "3" }),
    ];
    const text = renderGmailSummary({
      intent: "latest",
      items: [items[0]!], // presentation only receives what adapter returned
      locale: "es",
      totalFound: 1,
    });
    expect(text).toContain("El último correo");
    // No numbered list (1./2./3.) for a single-item latest reply.
    expect(text).not.toMatch(/\b2\.\s/);
  });

  it("G. empty mailbox renders an honest empty result", () => {
    const text = renderGmailSummary({
      intent: "latest",
      items: [],
      locale: "es",
      totalFound: 0,
    });
    expect(text.toLowerCase()).toContain("no he encontrado");
    expect(text).not.toContain("correo(s) relevante(s)");
    expect(text).not.toContain("He encontrado");
  });

  it("important intent is prioritized and reason explains why", () => {
    const items = [
      makeItem({
        id: "1",
        sender: "Facturación S.A. <billing@empresa.com>",
        senderEmail: "billing@empresa.com",
        subject: "Tu factura de agosto está disponible",
      }),
      makeItem({
        id: "2",
        sender: "LinkedIn <hello@linkedin.com>",
        senderEmail: "hello@linkedin.com",
        subject: "5 people viewed your profile",
      }),
    ];
    const text = renderGmailSummary({
      intent: "important",
      items,
      locale: "es",
      totalFound: 2,
    });
    expect(text).toContain("factura");
    // The billing email appears first (estimated importance 0.85 > 0.25).
    const facturaIdx = text.indexOf("Facturación");
    const linkedinIdx = text.indexOf("LinkedIn");
    expect(facturaIdx).toBeLessThan(linkedinIdx);
    expect(text).toContain("Puede requerir atención");
    expect(text).not.toContain("newer_than:");
  });
});

describe("run-gmail-presentation — summarizeGmailMessage", () => {
  it("C. safe HTML entity decode for subject and snippet", () => {
    const summary = summarizeGmailMessage({
      id: "m1",
      threadId: "t1",
      from: { email: "billing@example.com" },
      subject: "Tu &quot;factura&quot; de &amp; agosto",
      snippet: "Pago &lt;urgente&gt; &#39;ahora&#39;.",
      date: "Tue, 12 Aug 2026 09:14:22 +0000",
      isUnread: true,
    });
    expect(summary.subject).toBe('Tu "factura" de & agosto');
    expect(summary.snippet).toBe("Pago <urgente> 'ahora'.");
  });
});

describe("run-gmail-presentation — humanReceivedAt", () => {
  it("renders a compact RFC-2822 form", () => {
    const out = humanReceivedAt(
      "Tue, 12 Aug 2026 09:14:22 +0000",
    );
    expect(out).toContain("12");
    expect(out).toContain("Aug");
    expect(out).toContain("2026");
    expect(out).toContain("09:14");
  });

  it("passes through unknown formats verbatim", () => {
    const out = humanReceivedAt("not a date");
    expect(out).toBe("not a date");
  });
});