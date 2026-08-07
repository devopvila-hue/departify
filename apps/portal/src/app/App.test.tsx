import { render, screen } from "@testing-library/react";

import { App } from "@/app/App";

describe("App", () => {
  it("renders the Customer Zero route", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /cuéntame lo mínimo sobre tu empresa/i }),
    ).toBeInTheDocument();
  });
});
