import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { CredentialHelpDefinition } from "@/app/api";
import { CredentialSetupGuide, safeExternalUrl } from "@/components/CredentialSetupGuide";

const help: CredentialHelpDefinition = {
  whatYouNeed: "Una API Key.",
  steps: ["Abre la configuración.", "Crea una clave.", "Pégala aquí."],
  fields: [
    { id: "account", label: "Account ID", type: "text" },
    { id: "secret", label: "API Key", type: "password", secret: true },
  ],
  actionLabel: "Obtener API Key ↗",
  actionUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
};

describe("CredentialSetupGuide", () => {
  it("renders provider-specific steps, official link and hides secrets by default", () => {
    render(<CredentialSetupGuide providerName="Shopify" help={help} onClose={vi.fn()} onSubmit={vi.fn(async () => undefined)} />);

    expect(screen.getByText("Qué necesitas")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /obtener api key/i })).toHaveAttribute("target", "_blank");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
  });

  it("supports multiple fields, toggles secrets, and submits without persistence", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<CredentialSetupGuide providerName="Shopify" help={help} onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Account ID"), { target: { value: "account-1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ account: "account-1", secret: "secret-1" }));
    expect(window.localStorage.getItem("secret-1")).toBeNull();
  });

  it("does not render unsafe registry URLs", () => {
    expect(safeExternalUrl("http://example.com/key")).toBeNull();
    expect(safeExternalUrl("https://example.com/key")).toBeNull();
    render(<CredentialSetupGuide providerName="Shopify" help={{ ...help, actionUrl: "https://example.com/key" }} onClose={vi.fn()} onSubmit={vi.fn(async () => undefined)} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a humanized validation error without rendering technical details", () => {
    render(<CredentialSetupGuide providerName="Shopify" help={help} error="No hemos podido validar esta credencial. Comprueba el token." onClose={vi.fn()} onSubmit={vi.fn(async () => undefined)} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/No hemos podido validar/);
    expect(screen.queryByText(/401|unauthorized/i)).not.toBeInTheDocument();
  });
});
