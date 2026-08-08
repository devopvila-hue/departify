import { render, screen } from "@testing-library/react";

import { App } from "@/app/App";

describe("App", () => {
  it("renders the login screen as the entry point (P0-A)", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /entra en tu empresa/i }),
    ).toBeInTheDocument();
  });
});
