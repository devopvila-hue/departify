import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import type { ToolConnectionView } from "@/app/api";

function mount(ui: ReactElement) {
  return render(<MemoryRouter><OrgProvider>{ui}</OrgProvider></MemoryRouter>);
}

function base(over: Partial<ToolConnectionView>): ToolConnectionView {
  return {
    toolId: "gmail",
    label: "Gmail",
    name: "Gmail",
    capability: "email.read",
    capabilities: [],
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

function mockFetch(payload: unknown, postPayload: unknown = {}) {
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => init?.method === "POST" ? postPayload : payload,
  } as Response)));
}

function payload(connections: ToolConnectionView[]) {
  return { organizationId: "org_moon", connections, cards: [], unmappedTools: [] };
}

describe("ConnectionsRoute — compact lifecycle surface", () => {
  beforeEach(() => {
    window.localStorage.setItem("departify_customer_zero", JSON.stringify({ organizationId: "org_moon" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("renders connected tools compactly and keeps available tools out of the main grid", async () => {
    mockFetch(payload([
      base({ toolId: "gmail", state: "connected", hasState: true, action: null, accountLabel: "founder@departify.app", verifiedAt: "2026-08-10T00:00:00.000Z", capabilities: ["email.read"] }),
      base({ toolId: "google_ads", name: "Google Ads", label: "Google Ads", categoryId: "marketing", category: "Marketing", state: "available", action: "prepare" }),
    ]));
    mount(<ConnectionsRoute />);

    expect(await screen.findByRole("heading", { name: "Conexiones" })).toBeInTheDocument();
    expect(await screen.findByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText(/conectadas/)).toHaveTextContent("1 conectadas");
    expect(screen.queryByText("Google Ads")).not.toBeInTheDocument();
  });

  it("opens searchable catalog and manage drawer with human capabilities", async () => {
    mockFetch(payload([
      base({ toolId: "gmail", state: "connected", hasState: true, action: null, capabilities: ["email.read"] }),
      base({ toolId: "google_ads", name: "Google Ads", label: "Google Ads", categoryId: "marketing", category: "Marketing", state: "available", action: "prepare" }),
    ]));
    mount(<ConnectionsRoute />);

    fireEvent.click(await screen.findByRole("button", { name: /añadir/i }));
    expect(await screen.findByRole("dialog", { name: "Añadir una conexión" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar herramienta" }), { target: { value: "ads" } });
    fireEvent.click(screen.getByRole("button", { name: /google ads/i }));
    expect(await screen.findByRole("dialog", { name: "Google Ads" })).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();
  });

  it("keeps Facebook, Instagram and Meta Ads separate and never infers a connection", async () => {
    mockFetch(payload([
      base({ toolId: "meta_business", name: "Meta Business", label: "Meta Business", categoryId: "marketing", category: "Marketing", state: "connected", hasState: true, action: null, capabilities: ["marketing.ads.read"] }),
      base({ toolId: "meta_ads", name: "Meta Ads", label: "Meta Ads", categoryId: "marketing", category: "Marketing", state: "available", action: "prepare" }),
    ]));
    mount(<ConnectionsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /añadir/i }));
    expect(await screen.findByRole("button", { name: /facebook/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /instagram/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meta ads/i })).toBeInTheDocument();
    expect(screen.queryByText("Conectado")).not.toBeInTheDocument();
  });

  it("disconnects through the canonical endpoint and removes the tile", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => init?.method === "POST"
        ? { organizationId: "org_moon", toolId: "gmail", state: "needs_connection", providerRevoked: true }
        : payload([base({ toolId: "gmail", state: "connected", hasState: true, action: null })]),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    mount(<ConnectionsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /gmail/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/disconnect"), expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(/cuenta desconectada/i)).toBeInTheDocument();
  });
});
