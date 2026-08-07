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
  mandatoryQuestions: [
    {
      category: "vision",
      question: "¿Dónde quieres llevar tu empresa en los próximos años?",
      type: "open",
      importance: "critical",
      priority: 100,
    },
    {
      category: "ideal_customer",
      question: "¿Quién es tu cliente ideal?",
      type: "open",
      importance: "high",
      priority: 90,
    },
  ],
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

  it("persists the corrections and then asks the mandatory questions", async () => {
    mockFetch(async (url, init) => {
      if (url === "/api/customer-zero/analyze") {
        return okJson(analyzeResponse);
      }
      if (url.endsWith("/answers")) {
        const body = JSON.parse(String(init?.body));
        // First call: corrections (mission persisted).
        if (body.answers.mission === "Misión corregida por el CEO") {
          return okJson({
            organizationId: "org_moon",
            gaps: [],
            questions: [],
            mandatoryQuestions: analyzeResponse.mandatoryQuestions,
            companyDna: {},
            gapCount: 2,
          });
        }
        // Second call: answers to the mandatory questions.
        expect(body.answers.vision).toBe("Ser el co-living de referencia");
        expect(body.answers.ideal_customer).toBe("Nómadas digitales en Madrid");
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          mandatoryQuestions: [],
          companyDna: {},
          gapCount: 1,
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

    // The mandatory questions step is shown in the UI locale (Spanish).
    expect(
      await screen.findByText(/¿Dónde quieres llevar tu empresa en los próximos años?/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/¿Quién es tu cliente ideal?/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/¿Dónde quieres llevar tu empresa/i), {
      target: { value: "Ser el co-living de referencia" },
    });
    fireEvent.change(screen.getByLabelText(/¿Quién es tu cliente ideal?/i), {
      target: { value: "Nómadas digitales en Madrid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      await screen.findByRole("heading", { name: /confirmando el conocimiento/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 punto/)).toBeInTheDocument();
  });

  it("prepares Marketing and shows the department surface", async () => {
    mockFetch(async (url, init) => {
      if (url === "/api/customer-zero/analyze") return okJson(analyzeResponse);
      if (url.endsWith("/answers")) {
        const body = JSON.parse(String(init?.body));
        // First call: corrections → questions remain.
        if (body.answers.mission) {
          return okJson({
            organizationId: "org_moon",
            gaps: [],
            questions: [],
            mandatoryQuestions: analyzeResponse.mandatoryQuestions,
            companyDna: {},
            gapCount: 2,
          });
        }
        // Second call: mandatory questions answered → none remain.
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          mandatoryQuestions: [],
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

    // Answer the mandatory questions.
    const visionInput = await screen.findByLabelText(/¿Dónde quieres llevar tu empresa/i);
    fireEvent.change(visionInput, { target: { value: "Ser el co-living de referencia" } });
    fireEvent.change(screen.getByLabelText(/¿Quién es tu cliente ideal?/i), {
      target: { value: "Nómadas digitales" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

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
      if (url.endsWith("/answers")) {
        const body = JSON.parse(String(init?.body));
        if (body.answers.mission) {
          return okJson({
            organizationId: "org_moon",
            gaps: [],
            questions: [],
            mandatoryQuestions: analyzeResponse.mandatoryQuestions,
            companyDna: {},
            gapCount: 2,
          });
        }
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          mandatoryQuestions: [],
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

    const visionInput = await screen.findByLabelText(/¿Dónde quieres llevar tu empresa/i);
    fireEvent.change(visionInput, { target: { value: "Ser el co-living de referencia" } });
    fireEvent.change(screen.getByLabelText(/¿Quién es tu cliente ideal?/i), {
      target: { value: "Nómadas digitales" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /poner marketing a trabajar/i }),
    );
    await screen.findByRole("heading", { name: /departamento de marketing/i });

    fireEvent.change(screen.getByPlaceholderText(/escribe un mensaje/i), {
      target: { value: "¿Cuáles son las prioridades?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText(/priorizaría la comunidad/i)).toBeInTheDocument();
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

  it("lets the CEO give Marketing a goal, execute work and approve gated actions", async () => {
    mockFetch(async (url, init) => {
      if (url === "/api/customer-zero/analyze") return okJson(analyzeResponse);
      if (url.endsWith("/answers")) {
        const body = JSON.parse(String(init?.body));
        if (body.answers.mission) {
          return okJson({
            organizationId: "org_moon",
            gaps: [],
            questions: [],
            mandatoryQuestions: analyzeResponse.mandatoryQuestions,
            companyDna: {},
            gapCount: 2,
          });
        }
        return okJson({
          organizationId: "org_moon",
          gaps: [],
          questions: [],
          mandatoryQuestions: [],
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
      if (url.endsWith("/work")) {
        return okJson({
          organizationId: "org_moon",
          summary: "Plan para conseguir más clientes para MOON",
          items: [
            {
              id: "item_1",
              title: "Analizar audiencia",
              description: "Estudio del cliente ideal",
              kind: "analysis",
            },
            {
              id: "item_2",
              title: "Lanzar campaña de anuncios",
              description: "Inversión en anuncios",
              kind: "external_action",
              capability: "ads_spend",
            },
          ],
        });
      }
      if (url.endsWith("/item_1/execute")) {
        return okJson({
          organizationId: "org_moon",
          itemId: "item_1",
          status: "completed",
          result: "Análisis: los nómadas digitales buscan comunidad en Barcelona.",
        });
      }
      if (url.endsWith("/item_2/approve")) {
        return okJson({
          organizationId: "org_moon",
          itemId: "item_2",
          status: "unavailable",
          result: "Aprobado por el CEO. Esta capacidad todavía no está conectada.",
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
    const visionInput = await screen.findByLabelText(/¿Dónde quieres llevar tu empresa/i);
    fireEvent.change(visionInput, { target: { value: "Ser el co-living de referencia" } });
    fireEvent.change(screen.getByLabelText(/¿Quién es tu cliente ideal?/i), {
      target: { value: "Nómadas digitales" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /poner marketing a trabajar/i }),
    );
    await screen.findByRole("heading", { name: /departamento de marketing/i });

    // Give Marketing a business goal.
    fireEvent.change(screen.getByPlaceholderText(/por ejemplo: necesito conseguir más clientes/i), {
      target: { value: "Necesito conseguir más clientes." },
    });
    fireEvent.click(screen.getByRole("button", { name: /poner a trabajar/i }));

    expect(await screen.findByText(/plan para conseguir más clientes/i)).toBeInTheDocument();
    // Analysis item can be executed.
    fireEvent.click(screen.getAllByRole("button", { name: "Ejecutar" })[0]!);
    expect(await screen.findByText(/nómadas digitales buscan comunidad/i)).toBeInTheDocument();
    // External action requires approval and reports the honest unavailable state.
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(await screen.findByText(/capacidad todavía no está conectada/i)).toBeInTheDocument();
  });
});
