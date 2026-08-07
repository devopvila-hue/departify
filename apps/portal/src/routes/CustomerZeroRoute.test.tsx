import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { OrgProvider } from "@/app/org-context";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

/** The onboarding lives inside the portal shell's providers. */
function render(ui: ReactElement) {
  return rtlRender(
    <MemoryRouter>
      <OrgProvider>{ui}</OrgProvider>
    </MemoryRouter>,
  );
}

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

const runningProgress = {
  organizationId: "org_moon",
  status: "running",
  stages: [
    { id: "fetch", label: "Revisando la web", status: "done", finding: "Hemos leído Moon." },
    { id: "products", label: "Identificando qué vendes", status: "running" },
    { id: "audience", label: "Entendiendo a quién te diriges", status: "pending" },
  ],
  estimatedMs: null,
  understood: {},
};

const conversation = {
  organizationId: "org_moon",
  question: {
    id: "dna:ideal_customer",
    kind: "dna",
    category: "ideal_customer",
    question: "¿Quién es tu cliente ideal?",
    component: "text",
    weight: "blocking",
  },
  ready: false,
  gapCount: 8,
  connections: [],
  transcript: [],
  intro: "Ya conozco bastante bien tu empresa.",
};

const toolsConversation = {
  ...conversation,
  question: {
    id: "ops:tools",
    kind: "tools",
    question: "¿Qué herramientas utilizas más durante el día?",
    component: "multi_choice",
    options: ["Gmail", "Outlook", "Otra"],
    weight: "useful",
  },
  connections: [
    {
      toolId: "gmail",
      label: "Gmail",
      capability: "email.send",
      category: "Correo",
      status: "not_connected",
    },
  ],
};

describe("CustomerZeroRoute — UX v2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("starts with the minimum onboarding, not a Company DNA form", () => {
    mockFetch(() => okJson({}));
    render(<CustomerZeroRoute />);

    expect(
      screen.getByRole("heading", { name: /cuéntame lo mínimo sobre tu empresa/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("MOON Shared Living")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tengo página web/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /estoy empezando \/ no tengo web/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /conseguir clientes/i })).toBeInTheDocument();
  });

  it("never forces the CEO to type https://", async () => {
    const calls: { url: string; body: unknown }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/start")) return okJson({ organizationId: "org_moon" });
      return okJson(runningProgress);
    });

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("MOON Shared Living"), {
      target: { value: "MOON" },
    });
    fireEvent.click(screen.getByRole("button", { name: /tengo página web/i }));
    const urlField = screen.getByPlaceholderText("miempresa.com");
    expect(urlField).toHaveAttribute("type", "text");
    fireEvent.change(urlField, { target: { value: "moonsharedliving.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^empezar$/i }));

    await waitFor(() => expect(calls[0]?.url).toContain("/start"));
    expect((calls[0]?.body as { url: string }).url).toBe("moonsharedliving.com");
  });

  it("offers the no-website path with a description textarea", () => {
    mockFetch(() => okJson({}));
    render(<CustomerZeroRoute />);
    fireEvent.click(
      screen.getByRole("button", { name: /estoy empezando \/ no tengo web/i }),
    );
    expect(screen.getByText(/cuéntanos qué estás creando/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("miempresa.com")).not.toBeInTheDocument();
  });

  it("shows the live research stages with real state, not a static list", async () => {
    mockFetch((url) => {
      if (url.endsWith("/start")) return okJson({ organizationId: "org_moon" });
      return okJson(runningProgress);
    });

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("MOON Shared Living"), {
      target: { value: "MOON" },
    });
    fireEvent.click(screen.getByRole("button", { name: /tengo página web/i }));
    fireEvent.change(screen.getByPlaceholderText("miempresa.com"), {
      target: { value: "moonsharedliving.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^empezar$/i }));

    expect(await screen.findByText(/conociendo tu negocio/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Revisando la web")).toBeInTheDocument(),
    );
    expect(screen.getByText("Hemos leído Moon.")).toBeInTheDocument();
    const running = document.querySelector(".customer-zero__stage--running");
    expect(running).not.toBeNull();
  });

  it("asks ONE question at a time instead of a 14-question form", async () => {
    mockFetch((url) => {
      if (url.endsWith("/start")) return okJson({ organizationId: "org_moon" });
      if (url.endsWith("/progress"))
        return okJson({ ...runningProgress, status: "completed" });
      if (url.endsWith("/next-question")) return okJson(conversation);
      return okJson({});
    });

    render(<CustomerZeroRoute />);
    fireEvent.change(screen.getByPlaceholderText("MOON Shared Living"), {
      target: { value: "MOON" },
    });
    fireEvent.click(screen.getByRole("button", { name: /tengo página web/i }));
    fireEvent.change(screen.getByPlaceholderText("miempresa.com"), {
      target: { value: "moonsharedliving.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^empezar$/i }));

    expect(
      await screen.findByText("¿Quién es tu cliente ideal?"),
    ).toBeInTheDocument();
    // A single question, no "14 puntos necesitan confirmación".
    expect(screen.queryByText(/puntos necesitan confirmación/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".customer-zero__question").length).toBe(1);
  });

  it("shows visual tool options and a connection card with its CTA", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    mockFetch((url) => {
      if (url.endsWith("/next-question")) return okJson(toolsConversation);
      if (url.endsWith("/connect"))
        return okJson({
          connection: {
            ...toolsConversation.connections[0],
            status: "blocked",
            blockedReason: "Falta la credencial externa para conectar Gmail.",
          },
        });
      return okJson({ organizationId: "org_moon", department: null, conversation: [] });
    });

    render(<CustomerZeroRoute />);

    expect(
      await screen.findByText("¿Qué herramientas utilizas más durante el día?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Otra" })).toBeInTheDocument();
    expect(screen.getByText("○ No conectado")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /conectar gmail/i }));
    expect(
      await screen.findByText(/falta la credencial externa para conectar gmail/i),
    ).toBeInTheDocument();
  });

  it("closes discovery with continuity, never with 'Discovery completed'", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    mockFetch((url) => {
      if (url.endsWith("/next-question"))
        return okJson({
          ...conversation,
          question: null,
          ready: true,
          handoff:
            "Ya tengo suficiente para empezar. Me has dicho que quieres conseguir " +
            "los primeros 20 clientes en España.",
        });
      return okJson({ organizationId: "org_moon", department: null, conversation: [] });
    });

    render(<CustomerZeroRoute />);
    expect(
      await screen.findByText(/me has dicho que quieres conseguir los primeros 20 clientes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/discovery completed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vamos a trabajar/i })).toBeInTheDocument();
  });
});
