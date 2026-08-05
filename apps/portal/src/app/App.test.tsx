import { render, screen } from "@testing-library/react";

import { App } from "@/app/App";

describe("App", () => {
  it("renders the portal foundation route", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /portal foundation/i }),
    ).toBeInTheDocument();
  });
});
