import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
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
});
