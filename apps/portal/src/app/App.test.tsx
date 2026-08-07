import { render, screen } from "@testing-library/react";

import { App } from "@/app/App";

describe("App", () => {
  it("renders the onboarding as the entry point", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /cuéntame lo mínimo sobre tu empresa/i }),
    ).toBeInTheDocument();
  });
});
