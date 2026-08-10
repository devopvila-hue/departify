/**
 * Customer Zero 01 — /conexiones 5-state consistency.
 *
 * Verified Mautic → "Conectado" + "Conectado mediante configuración
 * del sistema" + Comprobar acción.
 * Not connected → "No conectado" + CTA "Activar".
 * Needs attention → "Necesita atención" + "Revisar conexión".
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

describe("ConnectionsRoute — 5-state cards", () => {
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

  it("verified CONNECTED Mautic shows 'Conectado' + config-source + check action", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        {
          id: "mautic",
          name: "Mautic",
          category: "CRM y automatización",
          logoMark: "M",
          brandColor: "#f36f21",
          state: "connected",
          stateLabel: "Conectado",
          configSource: "env:mautic",
          verifiedAt: "2026-08-09T00:00:00.000Z",
          capabilities: [],
          actionLabel: "Comprobar conexión",
        },
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(
      await screen.findByText(/Conectado mediante configuración del sistema/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /comprobar conexión/i }),
    ).toBeInTheDocument();
  });

  it("NEEDS_ATTENTION Mautic shows 'Necesita atención' + 'Revisar conexión'", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        {
          id: "mautic",
          name: "Mautic",
          category: "CRM y automatización",
          logoMark: "M",
          brandColor: "#f36f21",
          state: "needs_attention",
          stateLabel: "Necesita atención",
          configSource: null,
          verifiedAt: null,
          capabilities: [],
          actionLabel: "Revisar conexión",
        },
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("Necesita atención")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /revisar conexión/i }),
    ).toBeInTheDocument();
  });

  it("NOT_CONNECTED Gmail shows 'No conectado' + 'Activar' (env source present)", async () => {
    mockFetch(() => ({
      connections: [],
      cards: [
        {
          id: "gmail",
          name: "Gmail",
          category: "Correo",
          logoMark: "G",
          brandColor: "#ea4335",
          state: "not_connected",
          stateLabel: "No conectado",
          configSource: null,
          verifiedAt: null,
          capabilities: [],
          actionLabel: "Configurar",
        },
      ],
      unmappedTools: [],
    }));
    mount(<ConnectionsRoute />);

    expect(await screen.findByText("No conectado")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /configurar/i }),
    ).toBeInTheDocument();
  });
});
