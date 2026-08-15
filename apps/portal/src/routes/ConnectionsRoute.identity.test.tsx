import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import type { ToolConnectionView } from "@/app/api";

function mount(ui: ReactElement) {
  return render(<MemoryRouter><OrgProvider>{ui}</OrgProvider></MemoryRouter>);
}

function item(over: Partial<ToolConnectionView>): ToolConnectionView {
  return {
    toolId: "gmail", label: "Gmail", name: "Gmail", capability: "email.read", capabilities: [],
    category: "Correo", categoryId: "email", logoMark: "G", brandColor: "#ea4335",
    description: "Correo empresarial.", domains: ["email"], state: "connected", hasState: true,
    humanLabel: "Conectado", action: null, ...over,
  };
}

function mock(connections: ToolConnectionView[]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true, status: 200, json: async () => ({ organizationId: "org_moon", connections, cards: [], unmappedTools: [] }),
  } as Response)));
}

describe("ConnectionsRoute — canonical connection identity", () => {
  beforeEach(() => window.localStorage.setItem("departify_customer_zero", JSON.stringify({ organizationId: "org_moon" })));
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

  it("renders Google identity from canonical metadata and account label", async () => {
    mock([
      item({ toolId: "gmail", accountLabel: "founder@departify.app", capabilities: ["email.read"] }),
      item({ toolId: "google_calendar", name: "Google Calendar", label: "Google Calendar", category: "Calendario", categoryId: "calendar", capabilities: ["calendar.read"] }),
      item({ toolId: "google_drive", name: "Google Drive", label: "Google Drive", category: "Documentos", categoryId: "documents", capabilities: ["drive.read"] }),
    ]);
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Google Drive")).toBeInTheDocument();
  });

  it("does not render the hidden technical Google Workspace umbrella", async () => {
    mock([
      item({ toolId: "gmail" }),
      item({ toolId: "google_workspace", name: "Google Workspace", label: "Google Workspace", userVisible: false }),
    ]);
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("Gmail")).toBeInTheDocument();
    expect(screen.queryByText("Google Workspace")).not.toBeInTheDocument();
  });

  it("shows a safe empty state when canonical data is unavailable", async () => {
    mock([]);
    mount(<ConnectionsRoute />);
    expect(await screen.findByText("No hay conexiones disponibles")).toBeInTheDocument();
  });
});
