import { render, screen } from "@testing-library/react";

import { App } from "@/app/App";

describe("App", () => {
  it("renders the Customer Zero route", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /empieza con la web de tu empresa/i }),
    ).toBeInTheDocument();
  });
});
