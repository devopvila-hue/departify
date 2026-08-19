/**
 * Central Chat UX P0 — chat interaction regression suite.
 *
 * Verifies:
 *   S1. Proactive opening connection cards are filtered from the visible
 *       transcript (chat is conversational, not a dashboard).
 *   S2. Sending a new CEO message while scrolled up returns the viewport
 *       to the latest exchange (forced follow on send).
 *   S3. The "Ir al último mensaje" affordance appears when the CEO has
 *       scrolled up and clicking it snaps back to the bottom.
 *   S4. A passive update does NOT yank the viewport down while the CEO
 *       is reading older history (scroll position preserved).
 *   S5. Loading an existing conversation requests the latest-message
 *       position after the history has rendered.
 */

import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrgProvider, useOrg } from "@/app/org-context";
import { ChatRoute } from "@/routes/ChatRoute";

const openingEs = {
  organizationId: "org_moon",
  events: [
    {
      kind: "intent_proactive",
      intent: "open",
      title: "Elvira toma la iniciativa",
      message: "Para conseguir tu objetivo (conseguir 20 clientes en Barcelona), Elvira va a empezar por validar audiencia y mensaje.",
    },
    {
      kind: "connection_need",
      suggestion: {
        toolId: "brevo",
        label: "Brevo",
        capability: "email.send",
        why: "Para enviar tus campañas, Marketing necesita acceso a Brevo.",
        connectable: false,
        requiredCredentials: [],
        rawInput: "brevo",
      },
    },
  ],
};

const conversations = {
  organizationId: "org_moon",
  conversations: [
    {
      id: "conv-1",
      organizationId: "org_moon",
      title: "Conversación",
      status: "active" as const,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      lastMessageAt: "2026-08-10T00:00:00.000Z",
    },
    {
      id: "conv-2",
      organizationId: "org_moon",
      title: "Otra conversación",
      status: "active" as const,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      lastMessageAt: "2026-08-09T00:00:00.000Z",
    },
  ],
  activeCount: 2,
  maxActive: 5,
};

const conversationDetail = {
  conversation: {
    id: "conv-1",
    organizationId: "org_moon",
    title: "Conversación",
    status: "active" as const,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  },
  messages: [
    { id: "m1", conversationId: "conv-1", role: "user" as const, content: "¿Cuál es el último correo recibido?", createdAt: "2026-08-10T09:00:00.000Z" },
    { id: "m2", conversationId: "conv-1", role: "assistant" as const, content: "El último correo que has recibido:", createdAt: "2026-08-10T09:00:05.000Z" },
    { id: "m3", conversationId: "conv-1", role: "user" as const, content: "¿Tengo correos importantes?", createdAt: "2026-08-10T09:01:00.000Z" },
    { id: "m4", conversationId: "conv-1", role: "assistant" as const, content: "He encontrado 2 correos que podrían necesitar tu atención:", createdAt: "2026-08-10T09:01:10.000Z" },
  ],
};

const assistantReply = {
  organizationId: "org_moon",
  reply: "He encontrado 2 correos que podrían necesitar tu atención:",
  events: [
    {
      kind: "transcript",
      role: "assistant" as const,
      content: "He encontrado 2 correos que podrían necesitar tu atención:",
      speaker: "departify" as const,
    },
  ],
  routing: { intent: "external_tool_query", departments: ["marketing"], rationale: "Gmail question." },
  connectionSuggestion: null,
  pendingToolId: null,
  conversationId: "conv-1",
};

const conversationTwoDetail = {
  conversation: {
    id: "conv-2",
    organizationId: "org_moon",
    title: "Otra conversación",
    status: "active" as const,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
  messages: [
    {
      id: "m5",
      conversationId: "conv-2",
      role: "user" as const,
      content: "Mensaje de la otra conversación",
      createdAt: "2026-08-09T09:00:00.000Z",
    },
  ],
};

function mockChatFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      let body: unknown;
      if (u.includes("/conversations/history")) {
        body = { organizationId: "org_moon", conversations: [] };
      } else if (u.includes("/command-center/opening")) {
        body = openingEs;
      } else if (u.includes("/conversations/conv-1/messages")) {
        body = assistantReply;
      } else if (u.includes("/conversations/conv-2")) {
        body = conversationTwoDetail;
      } else if (u.includes("/conversations/conv-1")) {
        body = conversationDetail;
      } else if (u.includes("/conversations")) {
        body = conversations;
      } else {
        body = { organizationId: "org_moon", conversations: [], activeCount: 0, maxActive: 5 };
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

function OrgSwitcher() {
  const { setOrganizationId } = useOrg();
  return (
    <button type="button" onClick={() => setOrganizationId("org_sun")}>
      Cambiar empresa
    </button>
  );
}

function scroller(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".dfy-chat-scroller");
  if (!el) throw new Error("scroller not found");
  return el;
}

function setupScrollMetrics(el: HTMLElement, scrollHeight = 900, clientHeight = 300) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, configurable: true, writable: true });
}

function scrollTo(el: HTMLElement, top: number) {
  Object.defineProperty(el, "scrollTop", { value: top, configurable: true, writable: true });
  el.dispatchEvent(new Event("scroll", { bubbles: true }));
}

describe("Central Chat UX P0 — chat interaction", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    mockChatFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("S1. opening connection cards are filtered; the greeting card renders", async () => {
    const { container } = renderChat();
    // The proactive intent card is the canonical opening.
    expect(await screen.findByText(/elvira toma la iniciativa/i)).toBeInTheDocument();
    // The unrelated Brevo connection card from the opening is filtered.
    expect(screen.queryByText(/para enviar tus campañas/i)).not.toBeInTheDocument();
    // The conversation transcript is loaded.
    expect(await screen.findByText(/¿Tengo correos importantes\?/i)).toBeInTheDocument();
    void container;
  });

  it("S2. sending while scrolled up returns the viewport to the latest exchange", async () => {
    const { container } = renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    const el = scroller(container);
    setupScrollMetrics(el);
    await waitFor(() => expect(el.scrollTop).toBe(0));
    // The CEO scrolls up to re-read history → manual override.
    scrollTo(el, 120);
    act(() => {
      // Force a re-render so the scroll listener state settles.
      el.dispatchEvent(new Event("scroll"));
    });
    const input = await screen.findByLabelText(/mensaje para departify/i);
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "¿Tengo correos importantes?" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    // Sending always snaps back to the latest exchange.
    await waitFor(() => expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight));
  });

  it("S2b. a transport failure recovers a durable completed turn", async () => {
    const value = "¿Qué tal va la campaña?";
    const recoveredReply = "La respuesta ya estaba completada y se ha recuperado.";
    const persisted = {
      ...conversationDetail,
      messages: [
        ...conversationDetail.messages,
        {
          id: "m5",
          conversationId: "conv-1",
          role: "user" as const,
          content: value,
          createdAt: "2026-08-10T09:02:00.000Z",
        },
        {
          id: "m6",
          conversationId: "conv-1",
          role: "assistant" as const,
          content: recoveredReply,
          createdAt: "2026-08-10T09:02:05.000Z",
        },
      ],
    };
    mockChatFetch();
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        const target = String(url);
        if (target.includes("/conversations/conv-1/messages")) {
          return Promise.resolve({
            ok: false,
            status: 504,
            json: async () => ({ error: { code: "stream_failed" } }),
          } as Response);
        }
        if (target.includes("/conversations/conv-1") && init?.method !== "POST") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => persisted,
          } as Response);
        }
        return baseFetch(url, init);
      }),
    );

    renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    await screen.findByText(/¿tengo correos importantes\?/i);
    const input = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

    await waitFor(() => expect(document.body.textContent).toContain(recoveredReply));
    expect(
      screen.queryByText(/departify no ha podido responderte ahora mismo/i),
    ).not.toBeInTheDocument();
  });

  it("S3. 'Volver al último mensaje' appears when scrolled up and snaps to the bottom", async () => {
    const { container } = renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    const el = scroller(container);
    setupScrollMetrics(el, 900, 300);
    // Scroll well above the bottom (distance 900-100-300 = 500 ≥ 80).
    scrollTo(el, 100);
    // A re-render surfaces the affordance (a passive event or a new turn).
    fireEvent.change(
      await screen.findByLabelText(/mensaje para departify/i),
      { target: { value: "hola" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("chat-jump-latest")).toBeInTheDocument(),
    );
    // Clicking the affordance snaps to the bottom.
    scrollTo(el, 60);
    fireEvent.click(screen.getByTestId("chat-jump-latest"));
    await waitFor(() => expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight));
  });

  it("S3b. scrolling up immediately exposes the latest-message affordance", async () => {
    const { container } = renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    const el = scroller(container);
    setupScrollMetrics(el, 900, 300);

    scrollTo(el, 100);

    await waitFor(() =>
      expect(screen.getByTestId("chat-jump-latest")).toBeInTheDocument(),
    );
  });

  it("S4. a passive event does not yank the viewport while reading history", async () => {
    const { container } = renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    const el = scroller(container);
    setupScrollMetrics(el, 900, 300);
    // CEO is reading old history, well above the bottom.
    scrollTo(el, 100);
    expect(el.scrollTop).toBe(100);
    // Simulate a passive state update without a send (events change).
    act(() => {
      // No new send: scrollTop must stay put.
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el.scrollTop).toBe(100);
  });

  it("S4b. streaming completion respects a manual scroll up", async () => {
    let resolveReply: ((response: Response) => void) | undefined;
    const pendingReply = new Promise<Response>((resolve) => {
      resolveReply = resolve;
    });
    mockChatFetch();
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes("/conversations/conv-1/messages") && init?.method === "POST") {
          return pendingReply;
        }
        return baseFetch(url, init);
      }),
    );

    const { container } = renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    const el = scroller(container);
    setupScrollMetrics(el, 900, 300);
    const input = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(input, { target: { value: "sigue la respuesta" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    // Hotfix — the writing indicator replaces the old "Recibido" pill.
    await screen.findByTestId("chat-writing-indicator");

    // The CEO can move back into the history while the answer is pending.
    scrollTo(el, 100);
    await waitFor(() => expect(screen.getByTestId("chat-jump-latest")).toBeInTheDocument());

    resolveReply?.({
      ok: true,
      status: 200,
      json: async () => assistantReply,
    } as Response);

    await screen.findByText(/he encontrado 2 correos/i);
    expect(el.scrollTop).toBe(100);
    expect(screen.getByTestId("chat-jump-latest")).toBeInTheDocument();
  });

  it("S5. an existing conversation restores the viewport to the latest message", async () => {
    const { container } = renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);
    const el = scroller(container);
    setupScrollMetrics(el, 900, 300);

    // The history load happens asynchronously. This render represents the
    // first layout pass after the loaded transcript is in the DOM.
    fireEvent.change(await screen.findByLabelText(/mensaje para departify/i), {
      target: { value: "" },
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFor(() => expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight));
  });

  it("S6. the CEO thread is continuous and does not expose session switching", async () => {
    renderChat();
    await screen.findByText(/elvira toma la iniciativa/i);

    const input = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    await screen.findByText(/he encontrado 2 correos/i);

    expect(screen.queryByRole("button", { name: /conversaciones/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nueva conversación/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Conversación única")).toHaveTextContent("Conversación continua");
  });

  it("S7. an older organization load cannot overwrite the new organization transcript", async () => {
    let releaseMoonOpening: ((value: Response) => void) | undefined;
    const moonOpening = new Promise<Response>((resolve) => {
      releaseMoonOpening = resolve;
    });
    const sunOpening = {
      organizationId: "org_sun",
      events: [],
    };
    const sunConversations = {
      organizationId: "org_sun",
      conversations: [
        {
          id: "sun-conv",
          organizationId: "org_sun",
          title: "Empresa Sol",
          status: "active" as const,
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
      activeCount: 1,
      maxActive: 1,
    };
    const sunDetail = {
      conversation: sunConversations.conversations[0],
      messages: [
        {
          id: "sun-message",
          conversationId: "sun-conv",
          role: "assistant" as const,
          content: "Historial de Empresa Sol",
          createdAt: "2026-08-11T09:00:00.000Z",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const target = String(url);
        if (target.includes("org_moon/command-center/opening")) return moonOpening;
        if (target.includes("org_sun/command-center/opening")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => sunOpening } as Response);
        }
        if (target.includes("org_sun/conversations/sun-conv")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => sunDetail } as Response);
        }
        if (target.includes("org_sun/conversations")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => sunConversations } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
      }),
    );

    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <OrgProvider>
          <OrgSwitcher />
          <ChatRoute />
        </OrgProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /cambiar empresa/i }));
    expect(await screen.findByText("Historial de Empresa Sol")).toBeInTheDocument();

    releaseMoonOpening?.({
      ok: true,
      status: 200,
      json: async () => ({
        organizationId: "org_moon",
        events: [{ kind: "transcript", role: "assistant", content: "Historial antiguo" }],
      }),
    } as Response);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Historial antiguo")).not.toBeInTheDocument();
  });
});
