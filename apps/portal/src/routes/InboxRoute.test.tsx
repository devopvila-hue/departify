import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { OrgProvider } from "@/app/org-context";
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
});
