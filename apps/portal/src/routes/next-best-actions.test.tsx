/**
 * Sprint 67 P0.1-B — Next Best Actions UI tests (N3, N7, N8).
 *
 * The resolver lives in the backend (apps/backend/test/next-best-actions.test.ts).
 * This file exercises only the portal half: chips appear under the latest
 * assistant reply, never more than 3, never on a greeting, and clicking
 * one is EXACTLY the user typing the request (same `send()` path).
 *
 *   N3 máximo 3 acciones
 *   N7 saludo simple → no fuerza sugerencias
 *   N8 click → mismo chat path + exactamente 1 ejecución
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrgProvider } from "@/app/org-context";
import { ChatRoute } from "@/routes/ChatRoute";

const openingEs = {
  organizationId: "org_nba",
  events: [
    {
      kind: "intent_proactive" as const,
      intent: "open",
      title: "Departify está organizando el primer plan",
      message: "Para empezar, validamos el SEO de tu web.",
    },
  ],
};

const conversations = {
  organizationId: "org_nba",
  conversations: [
    {
      id: "conv-nba",
      organizationId: "org_nba",
      title: "Conversación",
      status: "active" as const,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
      lastMessageAt: "2026-08-19T00:00:00.000Z",
    },
  ],
  activeCount: 1,
  maxActive: 5,
};

const conversationDetail = {
  conversation: {
    id: "conv-nba",
    organizationId: "org_nba",
    title: "Conversación",
    status: "active" as const,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
  },
  messages: [
    {
      id: "m1",
      conversationId: "conv-nba",
      role: "user" as const,
      content: "Audita mi web",
      createdAt: "2026-08-19T09:00:00.000Z",
    },
    {
      id: "m2",
      conversationId: "conv-nba",
      role: "assistant" as const,
      content: "He encontrado 3 problemas SEO.",
      createdAt: "2026-08-19T09:00:05.000Z",
    },
  ],
};

function makeReplyFixture(nextActions: unknown[] | undefined) {
  return {
    organizationId: "org_nba",
    reply: "He encontrado 3 problemas SEO.",
    events: [
      {
        kind: "transcript" as const,
        role: "assistant" as const,
        content: "He encontrado 3 problemas SEO.",
        speaker: "departify" as const,
      },
    ],
    routing: { intent: "delegate_seo", departments: ["seo"], rationale: "SEO audit." },
    connectionSuggestion: null,
    pendingToolId: null,
    conversationId: "conv-nba",
    nextActions,
  };
}

function mockChatFetch(reply: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      let body: unknown;
      if (u.includes("/conversations/history")) {
        body = { organizationId: "org_nba", conversations: [] };
      } else if (u.includes("/command-center/opening")) {
        body = openingEs;
      } else if (u.includes("/command-center/message")) {
        // Both the SSE stream and the JSON fallback land here in tests.
        body = reply;
      } else if (u.includes("/conversations/conv-nba/messages")) {
        body = reply;
      } else if (u.includes("/conversations/conv-nba")) {
        body = conversationDetail;
      } else if (u.includes("/conversations")) {
        body = conversations;
      } else {
        body = { organizationId: "org_nba", conversations: [], activeCount: 0, maxActive: 5 };
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
      } as Response);
    }),
  );
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <OrgProvider>
        <ChatRoute />
      </OrgProvider>
    </MemoryRouter>,
  );
}

describe("Sprint 67 P0.1-B — Next Best Actions UI", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_nba" }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("N3: never renders more than 3 chips, even if the backend oversupplies", async () => {
    const reply = makeReplyFixture([
      {
        id: "a1",
        label: "Acción 1",
        request: "Haz la primera cosa.",
        classification: "AVAILABLE_NOW",
      },
      {
        id: "a2",
        label: "Acción 2",
        request: "Haz la segunda cosa.",
        classification: "AVAILABLE_NOW",
      },
      {
        id: "a3",
        label: "Acción 3",
        request: "Haz la tercera cosa.",
        classification: "NEEDS_CONNECTION",
      },
      {
        id: "a4",
        label: "Acción 4 ignorada",
        request: "Esta nunca debería verse.",
        classification: "AVAILABLE_NOW",
      },
    ]);
    mockChatFetch(reply);
    renderChat();
    await screen.findByText(/departify está organizando/i);
    fireEvent.change(await screen.findByLabelText(/mensaje para departify/i), {
      target: { value: "Audita mi web" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    await waitFor(() =>
      expect(screen.getByTestId("chat-next-actions")).toBeInTheDocument(),
    );
    const chips = screen.getAllByTestId("chat-next-action");
    expect(chips.length).toBe(3);
    expect(chips.map((c) => c.textContent)).not.toContain("Acción 4 ignorada");
  });

  it("N7: a greeting yields no chips, even when the assistant replies", async () => {
    const reply = makeReplyFixture(undefined);
    mockChatFetch(reply);
    renderChat();
    await screen.findByText(/departify está organizando/i);
    fireEvent.change(await screen.findByLabelText(/mensaje para departify/i), {
      target: { value: "hola" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    await screen.findByText(/he encontrado 3 problemas/i);
    expect(screen.queryByTestId("chat-next-actions")).not.toBeInTheDocument();
  });

  it("N8: clicking a chip triggers exactly one new turn with the chip request as the user message", async () => {
    const seoReply = makeReplyFixture([
      {
        id: "seo_fix",
        label: "Corregir problemas prioritarios",
        request: "Corrige los problemas SEO prioritarios que encontraste en la auditoría.",
        classification: "AVAILABLE_NOW",
      },
    ]);
    const secondTurnBody = "Empezando a corregir.";
    let postCount = 0;
    let capturedSecondBody = "";

    const seoReplyClone = JSON.parse(JSON.stringify(seoReply));
    const followupReply = {
      organizationId: "org_nba",
      reply: secondTurnBody,
      events: [
        {
          kind: "transcript" as const,
          role: "assistant" as const,
          content: secondTurnBody,
          speaker: "departify" as const,
        },
      ],
      routing: { intent: "delegate_seo", departments: ["seo"], rationale: "fix." },
      connectionSuggestion: null,
      pendingToolId: null,
      conversationId: "conv-nba",
      nextActions: [],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        let body: unknown;
        if (u.includes("/conversations/history")) {
          body = { organizationId: "org_nba", conversations: [] };
        } else if (u.includes("/command-center/opening")) {
          body = openingEs;
        } else if (u.includes("/conversations/conv-nba/messages/stream") && method === "POST") {
          // SSE stream URL: returns a body-less response so the api falls
          // back to the JSON endpoint below. Turn counter is NOT incremented
          // — only the fallback carries the response that reaches the chat.
          body = seoReplyClone;
        } else if (u.includes("/conversations/conv-nba/messages") && method === "POST") {
          // JSON fallback: this is the response the chat receives.
          postCount += 1;
          try {
            const raw = init?.body;
            if (postCount === 2) {
              capturedSecondBody =
                typeof raw === "string" ? raw : init?.body ? String(raw) : "";
            }
          } catch {
            // ignore
          }
          body = postCount === 1 ? seoReplyClone : followupReply;
        } else if (u.includes("/conversations/conv-nba")) {
          body = conversationDetail;
        } else if (u.includes("/conversations")) {
          body = conversations;
        } else {
          body = { organizationId: "org_nba", conversations: [], activeCount: 0, maxActive: 5 };
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => body,
        } as Response);
      }),
    );

    renderChat();
    await screen.findByText(/departify está organizando/i);
    fireEvent.change(await screen.findByLabelText(/mensaje para departify/i), {
      target: { value: "Audita mi web" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    const chip = await screen.findByTestId("chat-next-action");
    expect(chip.textContent).toBe("Corregir problemas prioritarios");
    fireEvent.click(chip);

    await waitFor(() =>
      expect(document.body.textContent).toContain("Empezando a corregir."),
    );
    // The same chat path was used twice — one turn for the typed message,
    // one for the chip click. Total: 2 POSTs.
    expect(postCount).toBe(2);
    // The chip request reached the backend as the user message body.
    expect(capturedSecondBody).toContain(
      "Corrige los problemas SEO prioritarios que encontraste en la auditoría.",
    );
  });
});
