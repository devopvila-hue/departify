/**
 * Phase P-B final correction — /conexiones semantic consistency.
 *
 * A CONNECTED, verified, operational connector must NEVER render copy that
 * claims Departify cannot operate it. Declared tools without a connector show
 * SELECTED semantics, not a fake connection path.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";

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

describe("ConnectionsRoute — semantic consistency", () => {
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

  it("verified CONNECTED Mautic never claims Departify cannot operate it", async () => {
    mockFetch(() => ({
      connections: [
        {
          toolId: "mautic",
          label: "Mautic",
          capability: "crm.contacts",
          category: "CRM",
          domains: ["crm", "marketing"],
          state: "connected",
          hasState: true,
          humanLabel: "Conectado",
          action: null,
          verifiedAt: "2026-08-09T00:00:00.000Z",
        },
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(await screen.findByText(/Conexión verificada/i)).toBeInTheDocument();
    expect(screen.queryByText(/todavía no podemos operar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no podemos operar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument();
  });

  it("AVAILABLE Gmail offers only a declaration action, never a fake connect", async () => {
    mockFetch(() => ({
      connections: [
        {
          toolId: "gmail",
          label: "Gmail",
          capability: "email.send",
          category: "Correo",
          domains: ["email"],
          state: "available",
          hasState: false,
          humanLabel: "Disponible",
          action: "prepare",
        },
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("Disponible")).toBeInTheDocument();
    const declare = screen.getByRole("button", { name: /la utilizo/i });
    expect(declare).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /conectar gmail/i })).not.toBeInTheDocument();
  });

  it("SELECTED Gmail (no connector) shows 'próximamente' and no connection action", async () => {
    mockFetch(() => ({
      connections: [
        {
          toolId: "gmail",
          label: "Gmail",
          capability: "email.send",
          category: "Correo",
          domains: ["email"],
          state: "selected",
          hasState: true,
          humanLabel: "Seleccionada",
          action: null,
        },
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("Seleccionada")).toBeInTheDocument();
    expect(await screen.findByText(/Conexión con Departify próximamente/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /conectar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /la utilizo/i })).not.toBeInTheDocument();
  });
});
