import { fireEvent, render, screen } from "@testing-library/react";

import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

const analyzeResponse = {
  organizationId: "org_moon",
  url: "https://moon.example",
  understood: {
    companyName: "MOON Shared Living",
    activity: "Co-living",
    mission: "Co-living compartido en Barcelona y Madrid",
    market: "co-living",
    products: ["Habitación en piso compartido"],
    targetAudience: ["Nómadas digitales", "Jóvenes profesionales"],
    tone: ["cercano", "moderno"],
  },
  gaps: [{ id: "gap_market" }],
  questions: [{ id: "q_vision" }],
  companyDna: {},
  gapCount: 8,
};

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

function okJson(payload: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe("CustomerZeroRoute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with URL as the only initial input", () => {
    render(<CustomerZeroRoute />);

    expect(
      screen.getByRole("heading", { name: /empieza con la web de tu empresa/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://empresa.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /conocer mi negocio/i }),
    ).toBeInTheDocument();
    // No manual company form anymore.
    expect(screen.queryByLabelText("Empresa")).not.toBeInTheDocument();
  });

  it("shows the working state while analyzing, then the understanding review", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    mockFetch(() => new Promise((resolve) => (resolveFetch = resolve)));

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("https://empresa.com"), {
      target: { value: "https://moon.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /conocer mi negocio/i }));

    expect(screen.getByText(/conociendo tu negocio/i)).toBeInTheDocument();

    resolveFetch(okJson(analyzeResponse));

    expect(
      await screen.findByRole("heading", { name: /esto es lo que hemos entendido/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/MOON Shared Living/)).toBeInTheDocument();
    expect(screen.getByLabelText("Misión")).toHaveValue(
      "Co-living compartido en Barcelona y Madrid",
    );
  });

  it("submits the URL to the analyze endpoint and allows corrections", async () => {
    mockFetch(async (url, init) => {
      if (url === "/api/customer-zero/analyze") {
        return okJson(analyzeResponse);
      }
      if (url.endsWith("/correct")) {
        const body = JSON.parse(String(init?.body));
        expect(body.corrections.mission).toBe(
          "Misión corregida por el CEO",
        );
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          companyDna: {},
          gapCount: 2,
        });
      }
      return okJson({});
    });

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("https://empresa.com"), {
      target: { value: "https://moon.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /conocer mi negocio/i }));

    const missionInput = await screen.findByLabelText("Misión");
    fireEvent.change(missionInput, {
      target: { value: "Misión corregida por el CEO" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirmar y continuar/i }));

    expect(
      await screen.findByRole("heading", { name: /confirmando el conocimiento/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 puntos pendientes/)).toBeInTheDocument();
  });

  it("prepares Marketing and shows the department surface", async () => {
    mockFetch(async (url) => {
      if (url === "/api/customer-zero/analyze") return okJson(analyzeResponse);
      if (url.endsWith("/correct")) {
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          companyDna: {},
          gapCount: 1,
        });
      }
      if (url.endsWith("/marketing")) {
        return okJson({
          organizationId: "org_moon",
          department: {
            id: "dep_marketing",
            name: "Marketing",
            description: "Marketing department",
            directorAgentId: "agent_marketing_director",
            employeeAgentIds: ["agent_content_strategist"],
            status: "active",
            connections: [],
          },
          firstResult: { gapCount: 3 },
          gaps: [],
          questions: [],
          error: null,
        });
      }
      return okJson({});
    });

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("https://empresa.com"), {
      target: { value: "https://moon.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /conocer mi negocio/i }));
    await screen.findByRole("heading", { name: /esto es lo que hemos entendido/i });
    fireEvent.click(screen.getByRole("button", { name: /confirmar y continuar/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /poner marketing a trabajar/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /departamento de marketing/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/marketing ya conoce tu negocio/i)).toBeInTheDocument();
    expect(screen.getByText(/agent_marketing_director/)).toBeInTheDocument();
    expect(screen.getByText(/habla con marketing/i)).toBeInTheDocument();
  });

  it("sends a message to Marketing and shows the reply", async () => {
    mockFetch(async (url, init) => {
      if (url === "/api/customer-zero/analyze") return okJson(analyzeResponse);
      if (url.endsWith("/correct")) {
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          companyDna: {},
          gapCount: 1,
        });
      }
      if (url.endsWith("/marketing") && init?.method === "POST") {
        return okJson({
          organizationId: "org_moon",
          department: {
            id: "dep_marketing",
            name: "Marketing",
            description: "Marketing department",
            directorAgentId: "agent_marketing_director",
            employeeAgentIds: [],
            status: "active",
            connections: [],
          },
          firstResult: null,
          gaps: [],
          questions: [],
          error: null,
        });
      }
      if (url.endsWith("/messages")) {
        return okJson({
          organizationId: "org_moon",
          reply: "Gracias. Para MOON priorizaría la comunidad.",
        });
      }
      return okJson({});
    });

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("https://empresa.com"), {
      target: { value: "https://moon.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /conocer mi negocio/i }));
    await screen.findByRole("heading", { name: /esto es lo que hemos entendido/i });
    fireEvent.click(screen.getByRole("button", { name: /confirmar y continuar/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /poner marketing a trabajar/i }),
    );
    await screen.findByRole("heading", { name: /departamento de marketing/i });

    fireEvent.change(screen.getByPlaceholderText(/escribe un mensaje/i), {
      target: { value: "¿Cuáles son las prioridades?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText(/priorizaría la comunidad/i)).toBeInTheDocument();
    // The user message and the reply are both shown.
    expect(screen.getByText("Tú")).toBeInTheDocument();
    expect(screen.getAllByText(/director de marketing/i).length).toBeGreaterThan(0);
  });

  it("shows an error when analysis fails", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        error: { code: "WEB_ANALYSIS_FAILED", message: "La web no responde." },
      }),
    }));

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("https://empresa.com"), {
      target: { value: "https://moon.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /conocer mi negocio/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/la web no responde/i)).toBeInTheDocument();
  });
});
