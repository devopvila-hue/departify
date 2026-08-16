import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute, buildSurfaces } from "@/routes/ConnectionsRoute";
import { RouteErrorFallback } from "@/app/router";
import type { ToolConnectionView } from "@/app/api";

function mount(ui: ReactElement) {
  return render(<MemoryRouter><OrgProvider>{ui}</OrgProvider></MemoryRouter>);
}

function base(over: Partial<ToolConnectionView> = {}): ToolConnectionView {
  return {
    toolId: "gmail",
    label: "Gmail",
    name: "Gmail",
    capability: "email.read",
    capabilities: ["email.read"],
    category: "Correo",
    categoryId: "email",
    logoMark: "G",
    brandColor: "#ea4335",
    description: "Correo empresarial.",
    domains: ["email"],
    state: "available",
    hasState: false,
    humanLabel: "Disponible",
    action: "prepare",
    ...over,
  };
}

function payload(connections: ToolConnectionView[]) {
  return { organizationId: "org_moon", connections, cards: [], unmappedTools: [] };
}

describe("ConnectionsRoute — lifecycle", () => {
  beforeEach(() => {
    window.localStorage.setItem("departify_customer_zero", JSON.stringify({ organizationId: "org_moon" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("renders connected tools and keeps available tools in Add", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => url.includes("/connections") ? payload([
        base({ toolId: "gmail", state: "connected", hasState: true, action: null, accountLabel: "founder@departify.app" }),
        base({ toolId: "google_ads", name: "Google Ads", label: "Google Ads", category: "Marketing", categoryId: "marketing" }),
      ]) : {},
    } as Response)));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(screen.queryByText("Google Ads")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /\+ añadir/i }));
    expect(await screen.findByRole("button", { name: /google ads/i })).toBeInTheDocument();
  });

  it("supports search, manage and accessible disconnect confirmation", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => init?.method === "POST"
        ? { organizationId: "org_moon", toolId: "gmail", state: "needs_connection", providerRevoked: true }
        : payload([base({ state: "connected", hasState: true, action: null })]),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    mount(<ConnectionsRoute />);

    fireEvent.click(await screen.findByRole("button", { name: /gmail, conectado/i }));
    expect(await screen.findByRole("dialog", { name: "Gmail" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(await screen.findByRole("dialog", { name: /¿desconectar gmail/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: /¿desconectar gmail/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /gmail, conectado/i }));
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    const confirmDialog = await screen.findByRole("dialog", { name: /¿desconectar gmail/i });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connections/gmail/disconnect"),
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("keeps Facebook, Instagram and Meta Ads separate", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => payload([
        base({ toolId: "meta_business", name: "Meta Business", label: "Meta Business", state: "connected", hasState: true, capabilities: ["marketing.social.read"] }),
        base({ toolId: "meta_ads", name: "Meta Ads", label: "Meta Ads", category: "Marketing", categoryId: "marketing", capabilities: [] }),
      ]),
    } as Response)));
    mount(<ConnectionsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /\+ añadir/i }));
    expect(await screen.findByRole("button", { name: /facebook/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /instagram/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meta ads/i })).toBeInTheDocument();
    expect(screen.queryByText("Meta Business")).not.toBeInTheDocument();
  });

  it("keeps GitHub available when the canonical registry exposes its OAuth connector", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => payload([
        base({
          toolId: "github_repository",
          name: "GitHub",
          label: "GitHub",
          category: "Productividad",
          categoryId: "documents",
          connectionMethod: "oauth",
        }),
      ]),
    } as Response)));
    mount(<ConnectionsRoute />);

    fireEvent.click(await screen.findByRole("button", { name: /\+ añadir/i }));
    const row = await screen.findByRole("button", { name: /github/i });
    expect(row.querySelector("svg")).not.toBeNull();
    expect(row).toHaveTextContent("Disponible");

    const surface = buildSurfaces([base({
      toolId: "github_repository",
      name: "GitHub",
      label: "GitHub",
      connectionMethod: "oauth",
    })])[0];
    if (!surface) throw new Error("GitHub surface was not built");
    expect(surface.connectToolId).toBe("github_repository");
    expect(surface.unavailableReason).toBeUndefined();
  });

  it("keeps the complete Marketing catalog visible when connections are unconfigured", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => payload([
        base({ toolId: "meta_business", name: "Meta Business", label: "Meta Business", category: "Marketing", categoryId: "marketing" }),
        base({ toolId: "google_ads", name: "Google Ads", label: "Google Ads", category: "Publicidad", categoryId: "marketing" }),
        base({ toolId: "meta_ads", name: "Meta Ads", label: "Meta Ads", category: "Publicidad", categoryId: "marketing" }),
        base({ toolId: "google_analytics", name: "Google Analytics", label: "Google Analytics", category: "Marketing", categoryId: "marketing" }),
        base({ toolId: "tiktok", name: "TikTok", label: "TikTok", category: "Marketing", categoryId: "marketing" }),
        base({ toolId: "tiktok_ads", name: "TikTok Ads", label: "TikTok Ads", category: "Publicidad", categoryId: "marketing" }),
        base({ toolId: "shopify", name: "Shopify", label: "Shopify", category: "Marketing", categoryId: "marketing" }),
        base({ toolId: "wordpress", name: "WordPress", label: "WordPress", category: "Marketing", categoryId: "marketing" }),
        base({ toolId: "hubspot", name: "HubSpot", label: "HubSpot", category: "CRM", categoryId: "crm" }),
        base({ toolId: "brevo", name: "Brevo", label: "Brevo", category: "Correo", categoryId: "email" }),
        base({ toolId: "mailchimp", name: "Mailchimp", label: "Mailchimp", category: "Correo", categoryId: "email" }),
        base({ toolId: "dropbox", name: "Dropbox", label: "Dropbox", category: "Documentos", categoryId: "documents" }),
        base({ toolId: "microsoft_365", name: "Microsoft 365", label: "Microsoft 365", category: "Documentos", categoryId: "documents" }),
        base({ toolId: "microsoft_calendar", name: "Microsoft Outlook Calendar", label: "Microsoft Outlook Calendar", category: "Calendario", categoryId: "calendar" }),
        base({ toolId: "etsy", name: "Etsy", label: "Etsy", category: "Marketing", categoryId: "marketing" }),
      ]),
    } as Response)));
    mount(<ConnectionsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /\+ añadir/i }));

    for (const name of [
      "Facebook", "Instagram", "Meta Ads", "Google Ads", "Google Analytics", "TikTok", "TikTok Ads",
      "WordPress", "Shopify", "HubSpot", "Brevo", "Mailchimp", "Dropbox", "Microsoft 365",
      "Microsoft Outlook Calendar", "Etsy",
    ]) {
      const row = Array.from(document.querySelectorAll<HTMLElement>(".dfy-catalog-row"))
        .find((candidate) => candidate.querySelector(".dfy-catalog-row__copy strong")?.textContent === name);
      expect(row).toBeDefined();
      if (!row) throw new Error(`Missing catalog row: ${name}`);
      expect(row.querySelector("svg")).not.toBeNull();
      expect(row.querySelector(".dfy-connection-logo strong")).toBeNull();
    }
  });

  it("normalizes an available provider with a missing name before sorting", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => payload([
        base({
          toolId: "google_ads",
          name: undefined as unknown as string,
          label: "Google Ads",
          category: undefined as unknown as string,
          categoryId: undefined as unknown as ToolConnectionView["categoryId"],
        }),
      ]),
    } as Response)));
    mount(<ConnectionsRoute />);

    fireEvent.click(await screen.findByRole("button", { name: /\+ añadir/i }));
    expect(await screen.findByRole("button", { name: /google ads/i })).toBeInTheDocument();
  });

  it("renders a connected provider with partial metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => payload([
        base({
          name: undefined as unknown as string,
          label: "Gmail",
          state: "connected",
          hasState: true,
          action: null,
          category: undefined as unknown as string,
        }),
      ]),
    } as Response)));
    mount(<ConnectionsRoute />);

    expect(await screen.findByRole("button", { name: /gmail, conectado/i })).toBeInTheDocument();
  });

  it("sorts equal display names deterministically by surface id", () => {
    const surfaces = buildSurfaces([
      base({ toolId: "tiktok_ads", name: "Same provider", label: "Same provider", category: "Marketing", categoryId: "marketing" }),
      base({ toolId: "google_ads", name: "Same provider", label: "Same provider", category: "Marketing", categoryId: "marketing" }),
      base({ toolId: "meta_ads", name: "Same provider", label: "Same provider", category: "Marketing", categoryId: "marketing" }),
    ]);

    expect(surfaces.filter((surface) => ["google_ads", "meta_ads", "tiktok_ads"].includes(surface.surfaceId)).map((surface) => surface.surfaceId))
      .toEqual(["google_ads", "meta_ads", "tiktok_ads"]);
  });

  it("renders a business-safe route fallback instead of the raw router error", () => {
    mount(<RouteErrorFallback />);

    expect(screen.getByRole("alert")).toHaveTextContent(/no hemos podido abrir esta sección/i);
    expect(screen.queryByText(/unexpected application error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/localecompare/i)).not.toBeInTheDocument();
  });
});
