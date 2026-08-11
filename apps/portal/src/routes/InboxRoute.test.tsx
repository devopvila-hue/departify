import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { OrgProvider } from "@/app/org-context";
import { InboxRoute } from "@/routes/InboxRoute";

describe("InboxRoute — provider-neutral email sync", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org-inbox" }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("does not expose Gmail as the unified inbox provider", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ organizationId: "org-inbox", items: [] }),
      } as Response);
    }));
    render(
      <MemoryRouter>
        <OrgProvider><InboxRoute /></OrgProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Sincronizar correo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sincronizar Gmail" })).not.toBeInTheDocument();
    expect(screen.getByText(/Sincroniza tus cuentas de correo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar correo" }));
    await screen.findByRole("button", { name: "Sincronizar correo" });
    expect(calls.some((url) => url.includes("/inbox/sync"))).toBe(true);
  });
});
