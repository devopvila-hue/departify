import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { HomeRoute } from "@/routes/HomeRoute";
import { DecisionsRoute } from "@/routes/DecisionsRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { SettingsRoute } from "@/routes/SettingsRoute";
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

const openCommandCenter = {
  organizationId: "org_moon",
  events: [
    {
      kind: "intent_proactive",
      intent: "open",
      title: "Elvira toma la iniciativa",
      message:
        "Para conseguir tu objetivo, Elvira ha preparado un equipo y propone empezar por lo que más impacto tiene.",
    },
    {
      kind: "department_active",
      departmentId: "marketing",
      departmentName: "Marketing",
      directorName: "Elvira",
      directorRole: "Jefa de Marketing",
      directorInitials: "EL",
    },
  ],
};

const baseStatus = {
  organizationId: "org_moon",
  companyName: "MOON Shared Living",
  department: { id: "d", name: "Marketing", status: "active", employeeAgentIds: [] },
  connections: [],
  conversation: [],
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

  it("navigates by primary conversational surface and never offers 'Agentes'", () => {
    mount(<AppShell companyName="MOON Shared Living" pendingApprovals={1} />);

    for (const label of [
      "Tu empresa",
      "Chat",
      "Tareas",
      "Departamentos",
      "Conexiones",
      "Aprobaciones",
      "Resultados",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
    // "Empresa" (company DNA) and "Tu empresa" (control plane) are both present.
    expect(screen.getAllByRole("link", { name: /empresa/i }).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/agentes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/workflow/i)).not.toBeInTheDocument();
  });

  it("keeps Configuración separate from Empresa and labels unsupported settings honestly", async () => {
    mockFetch((url) => {
      if (url.includes("/connections")) return { connections: [], cards: [], unmappedTools: [] };
      return { organizationId: "org_moon", companyName: "MOON Shared Living", conversation: [] };
    });
    mount(<SettingsRoute />);
    expect(await screen.findByTestId("settings-route")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^preferencias operativas$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /lo que departify sabe/i })).not.toBeInTheDocument();
    // The Logo y branding card no longer says "todavía no disponible";
    // it shows the new clean empty-state copy that prompts the CEO to
    // upload a logo.
    expect(screen.getByText(/logo de tu empresa/i)).toBeInTheDocument();
  });

  it("guides and saves the organization BYOK key without rendering the secret", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/byok/providers")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            organizationId: "org_moon",
            providers: [
              {
                id: "openai",
                label: "OpenAI",
                enabled: true,
                credentialType: "api_key",
                requiresBaseUrl: false,
                apiKeyPlaceholder: "sk-…",
                documentationUrl:
                  "https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key",
                apiKeyUrl: "https://platform.openai.com/api-keys",
                models: [
                  { id: "gpt-4o-mini", label: "Recomendado — GPT-4o mini", recommended: true, enabled: true },
                ],
              },
            ],
          }),
        } as Response);
      }
      if (url.includes("/branding")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            organizationId: "org_moon",
            brandName: null,
            logo: null,
            updatedAt: null,
          }),
        } as Response);
      }
      if (url.includes("/llm-settings") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            organizationId: "org_moon",
            provider: "openai",
            providerName: "OpenAI",
            model: "gpt-4o-mini",
            modelLabel: "Recomendado — GPT-4o mini",
            configured: true,
            state: "connected",
            verifiedAt: "2026-08-17T00:00:00.000Z",
            error: null,
          }),
        } as Response);
      }
      if (url.includes("/llm-settings")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            organizationId: "org_moon",
            provider: "openai",
            providerName: "OpenAI",
            model: "gpt-4o-mini",
            modelLabel: "Recomendado — GPT-4o mini",
            configured: false,
            state: "needs_setup",
            verifiedAt: null,
            error: null,
            help: {
              actionUrl: "https://platform.openai.com/api-keys",
              docsUrl: "https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key",
              apiKeyPlaceholder: "sk-…",
              steps: [],
            },
          }),
        } as Response);
      }
      if (url.includes("/connections")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ connections: [], cards: [], unmappedTools: [] }) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ organizationId: "org_moon", companyName: "MOON Shared Living", conversation: [] }) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(<SettingsRoute />);

    const key = await screen.findByLabelText("API key");
    expect(key).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: /obtener api key/i })).toHaveAttribute("href", "https://platform.openai.com/api-keys");
    fireEvent.change(key, { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar y comprobar/i }));

    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.queryByText("sk-secret")).not.toBeInTheDocument();
    const saveCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/llm-settings") && init?.method === "POST");
    expect(saveCall?.[1]?.body).toContain("sk-secret");
  });

  it("homes the Command Center single chat and speaks in business terms", async () => {
    mockFetch((url) => {
      if (url.includes("/command-center/opening")) return openCommandCenter;
      if (url.includes("/overview")) return overview;
      if (url.endsWith(`/org_moon`)) return baseStatus;
      return overview;
    });
    mount(<HomeRoute />);

    // Command Center is the single chat surface.
    expect(
      screen.getByRole("heading", { name: /dile a departify/i }),
    ).toBeInTheDocument();
    // Proactive opening card from the Marketing Director.
    expect(
      await screen.findByText(/elvira toma la iniciativa/i),
    ).toBeInTheDocument();
    // Activity is rendered as a contextual card, with the same source of truth.
    expect(
      await screen.findByText(/elvira y su equipo han terminado/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tool|agent|token|workflow/i)).not.toBeInTheDocument();
  });

  it("presents approvals as business decisions from a named head", async () => {
    mockFetch((url) => {
      if (url.includes("/command-center/opening")) return openCommandCenter;
      if (url.includes("/overview")) return overview;
      if (url.endsWith(`/org_moon`)) return baseStatus;
      return overview;
    });
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

  it("shows Marketing as a department workspace linked to the canonical chat", async () => {
    mockFetch((url) => {
      if (url.includes("/api/departments/marketing/org_moon")) {
        return {
          id: "marketing",
          name: "Marketing",
          head,
          status: "disponible",
          employees: [
            { id: "e1", label: "Especialista en Contenido", role: "Creación de contenido", status: "disponible", capabilities: [] },
            { id: "e2", label: "Especialista en Adquisición", role: "Adquisición", status: "trabajando", capabilities: [], currentWork: "Preparando propuesta Google Ads" },
          ],
          employeesWorkingNow: 1,
          tools: [{ toolId: "google_ads", label: "Google Ads", capability: "Publicidad", status: "not_connected", note: "No conectado" }],
          toolsConnected: 0,
          activeObjective: null,
          pendingApprovals: [],
          recentActivity: [],
          results: [],
        };
      }
      if (url.endsWith("/handoff")) {
        return { message: "Ya tengo suficiente.", goal: overview.goal, head };
      }
      return overview;
    });

    mount(<MarketingRoute />);

    await waitFor(() => expect(screen.getByText("Elvira")).toBeInTheDocument());
    expect(screen.getAllByText(/marketing/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/especialista en adquisición/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /conversación de la empresa/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ir a dirección/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/mensaje para elvira/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openclaw|skill|agente|token/i)).not.toBeInTheDocument();
  });
});
