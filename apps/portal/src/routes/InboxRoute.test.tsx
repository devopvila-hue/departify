import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { OrgProvider } from "@/app/org-context";
import { setApiAccessToken } from "@/app/api";
import { InboxRoute } from "@/routes/InboxRoute";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";

describe("InboxRoute — provider-neutral email sync", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org-inbox" }),
    );
  });

  afterEach(() => {
    setApiAccessToken(null);
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("does not expose Gmail as the unified inbox provider", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ organizationId: "org-inbox", items: [] }),
      } as Response);
    }));
    render(
      <MemoryRouter>
        <OrgProvider><InboxRoute /></OrgProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Sincronizar correo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sincronizar Gmail" })).not.toBeInTheDocument();
    expect(screen.getByText(/Sincroniza tus cuentas de correo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar correo" }));
    await screen.findByRole("button", { name: "Sincronizar correo" });
    expect(calls.some((url) => url.includes("/inbox/sync"))).toBe(true);
  });

  it("opens the normalized message detail and never renders unsafe HTML", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const detail = url.includes("/inbox/inbox-1");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => detail
          ? {
            organizationId: "org-inbox",
            item: {
              id: "inbox-1",
              organizationId: "org-inbox",
              source: "hostinger",
              sourceMessageId: "42",
              channel: "email",
              category: "unknown",
              subject: "Get started with business email",
              sender: { email: "sender@example.com", displayName: "Hostinger" },
              senderEmail: "sender@example.com",
              preview: "Welcome to your business email.",
              plainText: "Welcome to your business email.\nAquí tienes los siguientes pasos.",
              htmlBody: "<p>Welcome</p><script>window.__bad = true</script>",
              recipients: [{ email: "ceo@example.com" }],
              cc: [],
              attachments: [],
              mailbox: "ceo@example.com",
              folder: "INBOX",
              receivedAt: "2026-08-11T10:00:00.000Z",
              unread: true,
              importance: 0,
              departmentId: null,
              isLead: false,
              state: "classified",
              relatedWorkItemId: null,
              relatedConversationId: null,
            },
          }
          : {
            organizationId: "org-inbox",
            items: [{
              id: "inbox-1",
              organizationId: "org-inbox",
              source: "hostinger",
              sourceMessageId: "42",
              channel: "email",
              category: "unknown",
              subject: "Get started with business email",
              sender: { email: "sender@example.com", displayName: "Hostinger" },
              senderEmail: "sender@example.com",
              preview: "Welcome to your business email.",
              receivedAt: "2026-08-11T10:00:00.000Z",
              unread: true,
              importance: 0,
              departmentId: null,
              isLead: false,
              state: "classified",
              relatedWorkItemId: null,
              relatedConversationId: null,
            }],
          },
      } as Response);
    }));
    render(
      <MemoryRouter>
        <OrgProvider><InboxRoute /></OrgProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Get started with business email" }));
    expect(await screen.findByRole("button", { name: "Volver al inbox" })).toBeInTheDocument();
    expect(await screen.findByText(/Welcome to your business email/)).toBeInTheDocument();
    expect(screen.getByText("Correo empresarial · ceo@example.com · INBOX")).toBeInTheDocument();
    expect(screen.queryByText("INBOX", { selector: "p" })).not.toBeInTheDocument();
  });

  it("sanitizes HTML-only messages before the read view", () => {
    const safe = sanitizeEmailHtml('<p style="color:red">Hola</p><script>alert(1)</script><a href="javascript:alert(1)">No</a>');
    expect(safe).toContain("Hola");
    expect(safe).not.toContain("script");
    expect(safe).not.toContain("style=");
    expect(safe).not.toContain("javascript:");
  });

  it("keeps the authenticated Inbox flow on the same API/session path", async () => {
    setApiAccessToken("session-token");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const item = {
      id: "inbox-auth-1",
      organizationId: "org-inbox",
      source: "hostinger",
      sourceMessageId: "message-1",
      channel: "email",
      category: "unknown",
      subject: "Mensaje autenticado",
      sender: { email: "sender@example.com" },
      senderEmail: "sender@example.com",
      preview: "Vista previa real",
      receivedAt: "2026-08-11T10:00:00.000Z",
      unread: true,
      importance: 0,
      departmentId: null,
      isLead: false,
      state: "classified",
      relatedWorkItemId: null,
      relatedConversationId: null,
      plainText: "Contenido autenticado",
      recipients: [],
      cc: [],
      attachments: [],
    };
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      requests.push(init ? { url, init } : { url });
      const response = url.includes("/inbox/inbox-auth-1")
        ? { organizationId: "org-inbox", item }
        : url.includes("/inbox/sync")
          ? { organizationId: "org-inbox", imported: 1, classified: 1, highImportance: 0 }
          : { organizationId: "org-inbox", items: [item] };
      return Promise.resolve({ ok: true, status: 200, json: async () => response } as Response);
    }));
    render(
      <MemoryRouter>
        <OrgProvider><InboxRoute /></OrgProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sincronizar correo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mensaje autenticado" }));
    expect(await screen.findByText("Contenido autenticado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver al inbox" }));

    expect(requests.some((request) => request.url.includes("/inbox/sync"))).toBe(true);
    expect(requests.some((request) => request.url.includes("/inbox/inbox-auth-1"))).toBe(true);
    for (const request of requests) {
      expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer session-token");
    }
  });
});
