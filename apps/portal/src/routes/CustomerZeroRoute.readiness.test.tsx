/**
 * Customer Zero P0 — the portal must not walk the CEO into the
 * operational product before Departify understands the company.
 *
 * WHAT WAS BROKEN
 *
 * On reload the route decided where to send the CEO by looking at
 * `status.department`. A company that had merely been provisioned was
 * therefore sent to /chat even though research had never completed, the
 * Company DNA had never been persisted, and the CEO had never confirmed
 * that Departify understood the business.
 *
 * READINESS decides now — `contextReady`, the backend's durable verdict.
 */
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigateSpy };
});

function render(ui: ReactElement) {
  return rtlRender(
    <MemoryRouter>
      <OrgProvider>{ui}</OrgProvider>
    </MemoryRouter>,
  );
}

function okJson(payload: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

const UNDERSTANDING = {
  organizationId: "org_acme",
  companyName: "Acme Solar Valencia",
  description:
    "Instalamos paneles solares para comunidades de propietarios en Valencia.",
  objective: "Conseguir 20 reuniones comerciales al mes.",
  geography: "Valencia",
  products: ["Instalación de paneles solares"],
  customers: ["Comunidades de propietarios"],
  declaredTools: [],
  uncertainties: [],
  confirmed: false,
  missing: [],
};

beforeEach(() => {
  navigateSpy.mockReset();
  window.localStorage.setItem(
    "departify_customer_zero",
    JSON.stringify({ organizationId: "org_acme" }),
  );
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Customer Zero P0 — readiness gates the operational product", () => {
  it("does NOT enter the chat when a department exists but context is not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/understanding")) return okJson(UNDERSTANDING);
        if (url.includes("/next-question")) {
          return okJson({
            organizationId: "org_acme",
            question: null,
            ready: false,
            gapCount: 0,
            connections: [],
            transcript: [],
          });
        }
        return okJson({
          organizationId: "org_acme",
          // A department row EXISTS — the old code would have navigated.
          department: { id: "marketing", name: "Marketing", status: "active", employeeAgentIds: [] },
          // But Departify does not understand the company yet.
          contextReady: false,
          contextMissing: ["research", "confirmation"],
          conversation: [],
          discoveryTranscript: [],
          connections: [],
          gapCount: 0,
          mandatoryQuestions: [],
          locale: "es",
        });
      }),
    );

    render(<CustomerZeroRoute />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    });
    expect(navigateSpy).not.toHaveBeenCalledWith("/chat", { replace: true });
    expect(navigateSpy).not.toHaveBeenCalledWith("/chat");
  });

  it("enters the chat when the backend confirms context is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        okJson({
          organizationId: "org_acme",
          department: null,
          contextReady: true,
          contextMissing: [],
          conversation: [],
          discoveryTranscript: [],
          connections: [],
          gapCount: 0,
          mandatoryQuestions: [],
          locale: "es",
        }),
      ),
    );

    render(<CustomerZeroRoute />);

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith("/chat", { replace: true });
    });
  });

  it("resumes at CEO confirmation when that is the only thing missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/understanding")) return okJson(UNDERSTANDING);
        return okJson({
          organizationId: "org_acme",
          department: null,
          contextReady: false,
          contextMissing: ["confirmation"],
          conversation: [],
          discoveryTranscript: [],
          connections: [],
          gapCount: 0,
          mandatoryQuestions: [],
          locale: "es",
        });
      }),
    );

    render(<CustomerZeroRoute />);

    // The CEO sees their company in business language — not JSON, not
    // "Company DNA", not readiness plumbing.
    await waitFor(() => {
      expect(
        screen.getByText("Esto es lo que he entendido de tu empresa"),
      ).toBeTruthy();
    });
    expect(screen.getByDisplayValue("Acme Solar Valencia")).toBeTruthy();
    expect(
      screen.getByDisplayValue("Conseguir 20 reuniones comerciales al mes."),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Valencia")).toBeTruthy();

    // No infrastructure vocabulary leaks to the CEO.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Company DNA");
    expect(body).not.toContain("contextReady");
    expect(body).not.toContain("RAG");
    expect(body).not.toContain("provenance");
    expect(navigateSpy).not.toHaveBeenCalledWith("/chat");
  });
});
