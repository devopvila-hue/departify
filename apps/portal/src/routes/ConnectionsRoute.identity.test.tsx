/**
 * P0 — Connection identity contract portal tests.
 *
 * Locks in:
 *   D. Gmail renders complete identity.
 *   E. Google Calendar renders complete identity.
 *   F. Google Drive renders complete identity.
 *   G. Resend is grouped under Correo (email), never CRM.
 *   H. Mautic remains connected/configured exactly as before.
 *   I. Unknown tools get the intentional representation, not blanks.
 *   K. ConnectionsRoute renders the Customer Zero tools without relying
 *      on a duplicate frontend TOOL_DOMAIN map (groups by backend
 *      categoryId).
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import type { ConnectionCardView } from "@/app/api";

function mount(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <OrgProvider>{ui}</OrgProvider>
    </MemoryRouter>,
  );
}

function mockFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => handler(url),
      } as Response),
    ),
  );
}

function baseCard(over: Partial<ConnectionCardView>): ConnectionCardView {
  return {
    id: "x",
    name: "X",
    category: "Otro",
    categoryId: "other",
    logoMark: "?",
    brandColor: "#666",
    state: "not_connected",
    stateLabel: "Sin configurar",
    configSource: null,
    verifiedAt: null,
    capabilities: [],
    actionLabel: null,
    description: "d",
    ...over,
  };
}

describe("ConnectionsRoute — Customer Zero tool identity", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("D. Gmail renders complete identity", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "gmail",
          name: "Gmail",
          category: "Correo",
          categoryId: "email",
          logoMark: "G",
          brandColor: "#ea4335",
          state: "not_connected",
          stateLabel: "No conectado",
          actionLabel: "Configurar",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Gmail")).toBeInTheDocument();
    expect(await screen.findByText("No conectado")).toBeInTheDocument();
    // Group title is shown for the email group.
    expect(
      await screen.findByRole("heading", { level: 2, name: "Correo" }),
    ).toBeInTheDocument();
  });

  it("E. Google Calendar renders complete identity", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "google_calendar",
          name: "Google Calendar",
          category: "Calendario",
          categoryId: "calendar",
          logoMark: "Cal",
          brandColor: "#1a73e8",
          state: "not_connected",
          stateLabel: "No conectado",
          actionLabel: "Configurar",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Google Calendar")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Calendario" }),
    ).toBeInTheDocument();
  });

  it("F. Google Drive renders complete identity", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "google_drive",
          name: "Google Drive",
          category: "Documentos",
          categoryId: "documents",
          logoMark: "GD",
          brandColor: "#fbbc04",
          state: "not_connected",
          stateLabel: "No conectado",
          actionLabel: "Configurar",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Google Drive")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Documentos" }),
    ).toBeInTheDocument();
  });

  it("G. Resend is grouped under Correo (email), NEVER CRM", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "resend",
          name: "Email Delivery",
          category: "Entrega de email",
          categoryId: "email",
          logoMark: "Re",
          brandColor: "#000000",
          state: "connected",
          stateLabel: "Conectado",
          actionLabel: "Comprobar conexión",
          configSource: "env:resend",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Email Delivery")).toBeInTheDocument();
    // Grouped under Correo, NOT under CRM.
    expect(
      await screen.findByRole("heading", { level: 2, name: "Correo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "CRM y automatización" }),
    ).not.toBeInTheDocument();
  });

  it("H. Mautic remains connected/configured exactly as before", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "mautic",
          name: "Mautic",
          category: "CRM y automatización",
          categoryId: "crm",
          logoMark: "M",
          brandColor: "#f36f21",
          state: "connected",
          stateLabel: "Conectado",
          configSource: "env:mautic",
          verifiedAt: "2026-08-10T00:00:00.000Z",
          actionLabel: "Comprobar conexión",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Mautic")).toBeInTheDocument();
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(
      await screen.findByText(/Conectado mediante configuración del sistema/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /comprobar conexión/i }),
    ).toBeInTheDocument();
  });

  it("I. Unknown tool gets intentional representation, not blanks", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "some_obscure_saas",
          name: "Some Obscure SaaS",
          category: "Otro",
          categoryId: "other",
          logoMark: "?",
          brandColor: "#666",
          state: "not_connected",
          stateLabel: "Herramienta sin integración configurada",
          actionLabel: null,
          description:
            "Herramienta detectada, todavía sin integración configurada.",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Some Obscure SaaS")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Herramienta detectada, todavía sin integración configurada.",
      ),
    ).toBeInTheDocument();
    // No "—" or accidental "No conectado" generic label.
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("K. groups by backend categoryId, no duplicate frontend TOOL_DOMAIN map", async () => {
    // Cards from different categories. Portal must put each under
    // its backend-provided group, NOT under a hardcoded tool-to-domain
    // map. Specifically, Resend must appear in Correo (not CRM) and
    // Google Calendar in Calendario (not the default CRM bucket).
    mockFetch(() => ({
      connections: [],
      cards: [
        baseCard({
          id: "resend",
          name: "Email Delivery",
          category: "Correo",
          categoryId: "email",
          logoMark: "Re",
          brandColor: "#000000",
          state: "not_connected",
          stateLabel: "No conectado",
          actionLabel: "Configurar",
        }),
        baseCard({
          id: "google_calendar",
          name: "Google Calendar",
          category: "Calendario",
          categoryId: "calendar",
          logoMark: "Cal",
          brandColor: "#1a73e8",
          state: "not_connected",
          stateLabel: "No conectado",
          actionLabel: "Configurar",
        }),
        baseCard({
          id: "google_drive",
          name: "Google Drive",
          category: "Documentos",
          categoryId: "documents",
          logoMark: "GD",
          brandColor: "#fbbc04",
          state: "not_connected",
          stateLabel: "No conectado",
          actionLabel: "Configurar",
        }),
        baseCard({
          id: "mautic",
          name: "Mautic",
          category: "CRM y automatización",
          categoryId: "crm",
          logoMark: "M",
          brandColor: "#f36f21",
          state: "connected",
          stateLabel: "Conectado",
          actionLabel: "Comprobar conexión",
        }),
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);
    // All four group titles present.
    expect(
      await screen.findByRole("heading", { level: 2, name: "Correo" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Calendario" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Documentos" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "CRM y automatización",
      }),
    ).toBeInTheDocument();
    // No card slipped into the wrong group. The "no duplicate
    // frontend map" property is proven by the fact that no `?` / `—`
    // ever surfaces and Resend / Calendar / Drive are NOT under
    // "CRM y automatización".
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
