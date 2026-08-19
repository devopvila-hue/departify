/**
 * Sprint 67 P0 hotfix — STOP / cancel generation.
 *
 * The CEO must be able to abort an in-flight chat turn without
 * triggering a JSON fallback, without showing an error alert, and
 * without leaving the UI in a stuck state. The "writing indicator"
 * pill that replaced the old activity labels also disappears when
 * STOP is pressed.
 *
 * The tests use a controlled promise that the test owns and resolves
 * on demand, so we can simulate a model that streams forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ChatRoute } from "@/routes/ChatRoute";
import { OrgProvider } from "@/app/org-context";

const openingEs = {
  organizationId: "org-a",
  events: [
    {
      kind: "intent_proactive",
      intent: "open",
      title: "Departify está organizando el primer plan",
      message: "Para validar tu empresa, Departify va a empezar por revisar el contexto.",
    },
  ],
};

const conversations = {
  organizationId: "org-a",
  conversations: [
    {
      id: "conv-1",
      organizationId: "org-a",
      title: "Conversación",
      status: "active" as const,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      lastMessageAt: "2026-08-10T00:00:00.000Z",
    },
  ],
  activeCount: 1,
  maxActive: 5,
};

const conversationDetail = {
  conversation: {
    id: "conv-1",
    organizationId: "org-a",
    title: "Conversación",
    status: "active" as const,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  },
  messages: [
    {
      id: "m1",
      conversationId: "conv-1",
      role: "user" as const,
      content: "primer mensaje",
      createdAt: "2026-08-10T09:00:00.000Z",
    },
    {
      id: "m2",
      conversationId: "conv-1",
      role: "assistant" as const,
      content: "Respuesta anterior.",
      createdAt: "2026-08-10T09:00:05.000Z",
    },
  ],
};

let pendingResponses: Array<{
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}> = [];

function nextPendingStream(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  const entry = { promise, resolve };
  pendingResponses.push(entry);
  return entry;
}

function setupPendingStream(): void {
  pendingResponses = [];
}

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/command-center/opening")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => openingEs,
        } as Response);
      }
      if (u.includes("/conversations/conv-1") && init?.method !== "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => conversationDetail,
        } as Response);
      }
      if (u.includes("/conversations") && init?.method !== "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => conversations,
        } as Response);
      }
      // SSE stream — pop the next pending one.
      const entry = pendingResponses.shift();
      if (entry) {
        return entry.promise;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    }),
  );
}

function renderChat(): void {
  localStorage.setItem(
    "departify_customer_zero",
    JSON.stringify({ organizationId: "org-a" }),
  );
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <OrgProvider>
        <ChatRoute />
      </OrgProvider>
    </MemoryRouter>,
  );
}

describe("Sprint 67 P0 — STOP / cancel generation", () => {
  beforeEach(() => {
    setupPendingStream();
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    pendingResponses = [];
  });

  it("S1. SEND button is replaced by STOP button while a generation is in flight", async () => {
    const p1 = nextPendingStream();
    renderChat();
    await screen.findByText(/primer mensaje/i);
    const input = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));
    // Writing indicator mounts once the run is in flight.
    await screen.findByTestId("chat-writing-indicator");
    expect(screen.getByTestId("chat-stop-button")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-send-button")).toBeNull();
    p1.resolve(
      new Response("event: result\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  it("S2. STOP removes the writing indicator and the composer is usable again", async () => {
    const p1 = nextPendingStream();
    renderChat();
    await screen.findByText(/primer mensaje/i);
    const input = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));
    await screen.findByTestId("chat-writing-indicator");
    fireEvent.click(screen.getByTestId("chat-stop-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("chat-writing-indicator")).toBeNull(),
    );
    // Composer is back to plain SEND mode.
    expect(screen.getByTestId("chat-send-button")).toBeInTheDocument();
    p1.resolve(
      new Response("event: result\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  it("S3. STOP does NOT show an error alert to the CEO", async () => {
    const p1 = nextPendingStream();
    renderChat();
    await screen.findByText(/primer mensaje/i);
    const input = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));
    await screen.findByTestId("chat-writing-indicator");
    fireEvent.click(screen.getByTestId("chat-stop-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("chat-writing-indicator")).toBeNull(),
    );
    expect(
      screen.queryByText(/departify no ha podido responderte ahora mismo/i),
    ).not.toBeInTheDocument();
    p1.resolve(
      new Response("event: result\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  it("S4. the next message after STOP works normally", async () => {
    const p1 = nextPendingStream();
    const p2 = nextPendingStream();
    renderChat();
    await screen.findByText(/primer mensaje/i);
    const input = await screen.findByLabelText(/mensaje para departify/i);
    // First send — aborted.
    fireEvent.change(input, { target: { value: "primer envío" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));
    await screen.findByTestId("chat-writing-indicator");
    fireEvent.click(screen.getByTestId("chat-stop-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("chat-writing-indicator")).toBeNull(),
    );
    // Second send — must succeed.
    const secondInput = await screen.findByLabelText(/mensaje para departify/i);
    fireEvent.change(secondInput, { target: { value: "segundo envío" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));
    await screen.findByTestId("chat-writing-indicator");
    // Resolve the second stream with a successful response.
    p2.resolve(
      new Response(
        [
          "event: result\n",
          'data: {"conversationId":"conv-1","reply":"Listo","events":[],"routing":{"intent":"direct_response","departments":[],"rationale":""},"connectionSuggestion":null,"pendingToolId":null}\n\n',
        ].join(""),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Listo/)).toBeInTheDocument(),
    );
    p1.resolve(
      new Response("event: result\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });
});
