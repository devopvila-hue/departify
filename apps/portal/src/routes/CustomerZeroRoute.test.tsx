import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

const completedResult = {
  status: "completed",
  organizationId: "org_moon_123",
  companyName: "MOON Shared Living",
  department: "Marketing",
  firstResult: {
    confidence: "low",
    gapCount: 14,
    criticalGapCount: 9,
    blockingGapCount: 9,
    questionCount: 20,
  },
  errors: [],
  runId: "run_abc",
};

function mockFetchOnce(payload: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    }),
  );
}

describe("CustomerZeroRoute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the form with the Marketing department", () => {
    render(<CustomerZeroRoute />);

    expect(
      screen.getByRole("heading", { name: /poner el departamento de marketing/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Empresa")).toHaveValue("MOON Shared Living");
    expect(
      screen.getByText(/departamento:/i).parentElement,
    ).toHaveTextContent("Marketing");
    expect(
      screen.getByRole("button", { name: /poner marketing a trabajar/i }),
    ).toBeInTheDocument();
  });

  it("shows the working state while executing", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(pending),
    );
    render(<CustomerZeroRoute />);

    fireEvent.click(
      screen.getByRole("button", { name: /poner marketing a trabajar/i }),
    );

    expect(
      screen.getAllByText(/marketing está trabajando/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /marketing está trabajando/i }),
    ).toBeDisabled();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => completedResult,
    });

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /primer resultado/i }),
      ).toBeInTheDocument(),
    );
  });

  it("submits the company information and shows the first result", async () => {
    mockFetchOnce(completedResult);
    render(<CustomerZeroRoute />);

    fireEvent.change(screen.getByLabelText(/información de tu empresa/i), {
      target: {
        value: "MOON Shared Living: co-living compartido en Barcelona y Madrid",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /poner marketing a trabajar/i }),
    );

    const fetchMock = vi.mocked(fetch);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.companyName).toBe("MOON Shared Living");
    expect(body.rawData.mission.statement).toContain("MOON");

    expect(
      await screen.findByRole("heading", { name: /primer resultado/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getAllByText("9")).toHaveLength(2);
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("shows an error when the server rejects the request", async () => {
    mockFetchOnce({}, false);
    render(<CustomerZeroRoute />);

    fireEvent.click(
      screen.getByRole("button", { name: /poner marketing a trabajar/i }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toBeInTheDocument();
    expect(screen.getByText(/no se pudo completar el trabajo/i)).toBeInTheDocument();
  });

  it("shows a pipeline error when the result failed", async () => {
    mockFetchOnce({
      status: "failed",
      organizationId: "org_moon_123",
      companyName: "MOON",
      department: "Marketing",
      firstResult: null,
      errors: [{ code: "PIPELINE_FAILED", message: "El trabajo falló." }],
      runId: "run_def",
    });
    render(<CustomerZeroRoute />);

    fireEvent.click(
      screen.getByRole("button", { name: /poner marketing a trabajar/i }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/el trabajo falló/i)).toBeInTheDocument();
  });
});
