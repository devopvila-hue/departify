import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { OrgProvider } from "@/app/org-context";
import { CompanyRoute } from "@/routes/CompanyRoute";

function mount() {
  window.localStorage.setItem(
    "departify_customer_zero",
    JSON.stringify({ organizationId: "org_company" }),
  );
  return render(
    <MemoryRouter>
      <OrgProvider><CompanyRoute /></OrgProvider>
    </MemoryRouter>,
  );
}

describe("CompanyRoute — truthful availability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("shows an unavailable state when company context cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network"))));
    mount();
    expect(await screen.findByRole("heading", { name: /no he podido cargar la información/i })).toBeInTheDocument();
    expect(screen.queryByText(/nada más por ahora/i)).not.toBeInTheDocument();
  });

  it("renders persisted company understanding instead of an empty placeholder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        status: 200,
        json: async () => url.includes("/understanding")
          ? {
              companyName: "Empresa real",
              description: "Servicios reales",
              objective: "Conseguir clientes",
              geography: "España",
              products: ["Consultoría"],
              customers: ["Pymes"],
              positioning: "Especialistas",
              businessModel: "Servicios",
              declaredTools: [],
              uncertainties: [],
              missing: [],
              confirmed: true,
              provenance: { products: "research" },
            }
          : {
              companyName: "Empresa real",
              discoveryTranscript: [],
              onboarding: null,
            },
      } as Response)),
    );
    mount();
    expect(await screen.findByText("Servicios reales")).toBeInTheDocument();
    expect(screen.getByText("Consultoría")).toBeInTheDocument();
  });
});
