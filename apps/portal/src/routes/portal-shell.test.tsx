import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { HomeRoute } from "@/routes/HomeRoute";
import { DecisionsRoute } from "@/routes/DecisionsRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { AppShell } from "@/components/AppShell";

const head = {
  departmentId: "marketing",
  department: "Marketing",
  name: "Elvira",
  initials: "EL",
  role: "Jefa de Marketing",
};

const overview = {
  organizationId: "org_moon",
  goal: "Conseguir los primeros 20 clientes en España",
  companyName: "MOON Shared Living",
  heads: [head],
  decisions: [
    {
      id: "item_3",
      head,
      proposal: "Propone lanzar la campaña de captación.",
      detail: "Campaña en redes para jóvenes profesionales.",
      status: "pending",
    },
  ],
  activity: [
    {
      id: "act_1",
      head,
      message: "Elvira y su equipo han terminado: análisis de mercado.",
      tone: "done",
    },
  ],
  results: [],
  connections: [],
  working: 1,
  done: 1,
};

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

describe("portal shell", () => {
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

  it("navigates by business area and never offers 'Agentes'", () => {
    mount(<AppShell companyName="MOON Shared Living" pending={1} />);

    for (const label of [
      "Inicio",
      "Marketing",
      "Decisiones",
      "Resultados",
      "Conexiones",
      "Empresa",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
    expect(screen.queryByText(/agentes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/workflow/i)).not.toBeInTheDocument();
  });

  it("asks the CEO what he wants to achieve and speaks in business terms", async () => {
    mockFetch(() => overview);
    mount(<HomeRoute />);

    expect(
      screen.getByRole("heading", { name: /¿qué quieres conseguir\?/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/elvira y su equipo han terminado/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tool|agent|token|workflow/i)).not.toBeInTheDocument();
  });

  it("presents approvals as business decisions from a named head", async () => {
    mockFetch(() => overview);
    mount(<DecisionsRoute />);

    expect(await screen.findByText("Elvira")).toBeInTheDocument();
    expect(screen.getByText(/jefa de marketing · marketing/i)).toBeInTheDocument();
    expect(
      screen.getByText(/propone lanzar la campaña de captación/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^aprobar$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ver propuesta/i })).toBeInTheDocument();
    expect(screen.queryByText(/approve tool execution|permission/i)).not.toBeInTheDocument();
  });

  it("shows Marketing led by its head, with honest tool state", async () => {
    mockFetch((url) => {
      if (url.endsWith("/handoff")) {
        return { message: "Ya tengo suficiente.", goal: overview.goal, head };
      }
      return {
        organizationId: "org_moon",
        companyName: "MOON Shared Living",
        department: { id: "d", name: "Marketing", status: "active", employeeAgentIds: [] },
        connections: [],
        conversation: [],
        marketingWork: {
          goal: overview.goal,
          summary: "Plan para captar los primeros clientes.",
          items: [
            {
              id: "item_1",
              title: "Analizar el mercado",
              description: "Buscar las oportunidades más rápidas.",
              kind: "analysis",
              status: "pending",
            },
          ],
        },
      };
    });

    mount(<MarketingRoute />);

    await waitFor(() => expect(screen.getByText("Elvira")).toBeInTheDocument());
    expect(screen.getByText(/jefa de marketing/i)).toBeInTheDocument();
    expect(screen.getByText("Analizar el mercado")).toBeInTheDocument();
    expect(
      screen.getByText(/sin conexiones activas, marketing no puede enviar/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /habla con elvira/i })).toBeInTheDocument();
  });
});
