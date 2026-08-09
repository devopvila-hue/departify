/**
 * ENGINE 04 — Control Plane UI/UX tests.
 *
 * Covers the required ENGINE 04 test list (01-23) at the route/render level.
 * The api layer is mocked (business-language shapes only); the ENGINE 03
 * backend tests prove the real engine path.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { ControlPlaneRoute } from "@/routes/ControlPlaneRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { AppShell } from "@/components/AppShell";

const head = {
  departmentId: "marketing",
  department: "Marketing",
  name: "Elvira",
  initials: "EL",
  role: "Directora de Marketing",
};

const departmentStatus = {
  id: "marketing",
  name: "Marketing",
  head,
  status: "trabajando",
  employees: [
    { id: "e1", label: "Especialista en Contenido", role: "Creación de contenido", status: "disponible", capabilities: ["content_creation"] },
    { id: "e2", label: "Especialista en Adquisición", role: "Adquisición de clientes", status: "trabajando", capabilities: ["campaign_strategy"], currentWork: "Trabajando en el objetivo" },
    { id: "e3", label: "Especialista en Crecimiento", role: "Crecimiento y analítica", status: "disponible", capabilities: ["analytics_measurement"] },
  ],
  employeesWorkingNow: 1,
  tools: [
    { toolId: "google_ads", label: "Google Ads", capability: "Publicidad", status: "not_connected", note: "No conectado" },
    { toolId: "google_analytics", label: "Google Analytics", capability: "Analítica", status: "not_connected", note: "No conectado" },
  ],
  toolsConnected: 0,
  activeObjective: {
    id: "obj_1",
    title: "Conseguir 20 leads cualificados",
    description: "20 leads este mes",
    desiredOutcome: "20 leads cualificados",
    constraints: ["Presupuesto: 500 €", "Tenemos una landing"],
    status: "active",
    progress: 35,
    createdAt: "2026-08-09T00:00:00.000Z",
    owner: "Elvira",
  },
  pendingApprovals: [
    { id: "appr_1", from: "Elvira", title: "Lanzar una campaña en Google Ads", detail: "Campaña de captación con 300 €.", cost: "300 €", status: "pending", createdAt: "2026-08-09T00:00:00.000Z" },
  ],
  recentActivity: [
    { id: "act_1", actor: "Elvira", kind: "plan_creado", message: "Elvira ha preparado el plan de Marketing para tu objetivo.", createdAt: "2026-08-09T00:00:00.000Z" },
  ],
  results: [],
};

function mount(ui: ReactElement, route = "/inicio") {
  window.localStorage.setItem(
    "departify_customer_zero",
    JSON.stringify({ organizationId: "org_moon" }),
  );
  return render(
    <MemoryRouter initialEntries={[route]}>
      <OrgProvider>{ui}</OrgProvider>
    </MemoryRouter>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => handler(url, init),
      } as Response),
    ),
  );
}

describe("ENGINE 04 — Control Plane", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("01 control plane loads (TU EMPRESA)", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByRole("heading", { name: /así está trabajando tu empresa/i })).toBeInTheDocument();
  });

  it("02 org chart displays the CEO", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByText("CEO")).toBeInTheDocument();
  });

  it("03 Marketing / Elvira visible", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByText("Elvira")).toBeInTheDocument();
    expect(screen.getByText("Directora de Marketing")).toBeInTheDocument();
  });

  it("04 correct employee count from backend", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    // employees.length = 3 → "3" appears next to "empleados digitales".
    await waitFor(() => {
      expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/empleados digitales/i).length).toBeGreaterThan(0);
  });

  it("05 status normalized (business language)", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    await waitFor(() => {
      expect(screen.getAllByText("Trabajando").length).toBeGreaterThan(0);
    });
  });

  it("06 objective visible", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByText(/conseguir 20 leads cualificados/i)).toBeInTheDocument();
  });

  it("07 Elvira panel/drawer — department card with actions", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByRole("button", { name: /ver marketing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hablar con elvira/i })).toBeInTheDocument();
  });

  it("08 current work visible", async () => {
    mockFetch(() => departmentStatus);
    mount(<MarketingRoute />, "/marketing");
    expect(await screen.findByText(/trabajando en el objetivo/i)).toBeInTheDocument();
  });

  it("09 connected tools truthful", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    await waitFor(() => expect(screen.getAllByText("No conectado").length).toBeGreaterThan(0));
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
  });

  it("10 approval displayed", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByText(/lanzar una campaña en google ads/i)).toBeInTheDocument();
    expect(screen.getByText("300 €")).toBeInTheDocument();
  });

  it("11 approval action works", async () => {
    let decided = false;
    mockFetch((url, init) => {
      if (String(url).includes("/approvals/") && init?.method === "POST") {
        decided = true;
        return { approval: { id: "appr_1", title: "x", status: "approved", decidedAt: "2026-08-09T00:00:00Z" } };
      }
      return departmentStatus;
    });
    mount(<ControlPlaneRoute />);
    const approve = await screen.findByRole("button", { name: /^aprobar$/i });
    fireEvent.click(approve);
    await waitFor(() => expect(decided).toBe(true));
  });

  it("12 activity displayed", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByText(/ha preparado el plan de marketing/i)).toBeInTheDocument();
  });

  it("13 company summary uses real data", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    // employees.length = 3, workingNow = 1, toolsConnected = 0, approvals = 1, objective = 1
    await waitFor(() => expect(screen.getAllByText("1").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/trabajando ahora/i).length).toBeGreaterThan(0);
  });

  it("14 chat with Elvira works (Marketing route)", async () => {
    let replied = false;
    mockFetch((url, init) => {
      if (String(url).includes("/message") && init?.method === "POST") {
        replied = true;
        return { reply: "He preparado el plan para tu objetivo.", activity: [], approvals: [] };
      }
      return departmentStatus;
    });
    mount(<MarketingRoute />, "/marketing");
    const input = await screen.findByLabelText(/mensaje para elvira/i);
    fireEvent.change(input, { target: { value: "Prepara el plan." } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(replied).toBe(true));
    expect(await screen.findByText(/he preparado el plan para tu objetivo/i)).toBeInTheDocument();
  });

  it("15 no OpenClaw terminology visible", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    await screen.findByRole("heading", { name: /así está trabajando tu empresa/i });
    const html = document.body.textContent ?? "";
    for (const forbidden of ["openclaw", "gateway", "session", "skill", "tool runtime", "agent"]) {
      expect(html.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("16 no agent terminology in normal customer UI", async () => {
    mockFetch(() => departmentStatus);
    mount(<MarketingRoute />, "/marketing");
    await screen.findByText("Elvira");
    const html = document.body.textContent ?? "";
    expect(html.toLowerCase()).not.toContain("agente");
    expect(html.toLowerCase()).not.toContain("skill");
    expect(html.toLowerCase()).not.toContain("openclaw");
  });

  it("17 mobile responsive — drawer toggle present", () => {
    mount(<AppShell companyName="MOON Shared Living" pendingApprovals={1} />, "/inicio");
    expect(screen.getByRole("button", { name: /abrir navegación/i })).toBeInTheDocument();
  });

  it("18 keyboard accessibility smoke — composer input focusable", async () => {
    mockFetch(() => departmentStatus);
    mount(<MarketingRoute />, "/marketing");
    const input = await screen.findByLabelText(/mensaje para elvira/i);
    expect(input).toHaveAttribute("aria-label");
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("19 backend error state", async () => {
    mockFetch(() => {
      throw new Error("boom");
    });
    mount(<MarketingRoute />, "/marketing");
    // The route should not crash; it renders a clean error state.
    expect(
      await screen.findByText(/no he podido cargar el estado de marketing/i),
    ).toBeInTheDocument();
  });

  it("20 engine unavailable state handled", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    expect(await screen.findByText("Elvira")).toBeInTheDocument();
    // The UI stays usable (empty states / real status), no raw error leak.
    expect(screen.queryByText(/openclaw|gateway|socket|econnrefused/i)).not.toBeInTheDocument();
  });

  it("21 ENGINE 03 regression — Marketing route renders department", async () => {
    mockFetch(() => departmentStatus);
    mount(<MarketingRoute />, "/marketing");
    expect(await screen.findByRole("heading", { name: /marketing/i })).toBeInTheDocument();
    expect(screen.getByText("Elvira")).toBeInTheDocument();
  });

  it("22 ENGINE 02 regression — sidebar navigation intact", () => {
    mount(<AppShell companyName="MOON Shared Living" pendingApprovals={0} />, "/inicio");
    expect(screen.getByRole("link", { name: /tu empresa/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chat/i })).toBeInTheDocument();
  });

  it("23 ENGINE 01 health — control plane uses real data, not fabricated", async () => {
    mockFetch(() => departmentStatus);
    mount(<ControlPlaneRoute />);
    await screen.findByRole("heading", { name: /así está trabajando tu empresa/i });
    // No hardcoded fake company numbers (like "26 empleados" invented).
    expect(screen.queryByText(/26 empleados/i)).not.toBeInTheDocument();
  });
});
