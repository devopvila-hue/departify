import { render, screen } from "@testing-library/react";

import { App } from "@/app/App";

describe("App", () => {
  it("renders the Customer Zero route", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /poner el departamento de marketing/i }),
    ).toBeInTheDocument();
  });
});
