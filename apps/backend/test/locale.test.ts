import { describe, it, expect } from "vitest";
import type { LlmRouter } from "@departify/llm-router";
import {
  interpretWebsite,
  interpretDescription,
} from "../src/customer-zero/web-analysis.js";
import { localeInstruction, resolveLocale } from "../src/customer-zero/locale.js";

function capturingRouter(reply: string) {
  const captured: { system: string } = { system: "" };
  const router = {
    getDefaultProviderId: () => "openai",
    chat: async (request: { messages: { role: string; content: string }[] }) => {
      captured.system = request.messages[0]?.content ?? "";
      return { type: "chat", message: reply };
    },
  } as unknown as LlmRouter;
  return { router, captured };
}

describe("locale propagation", () => {
  it("resolves the session locale defensively", () => {
    expect(resolveLocale("es-ES")).toBe("es");
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale(undefined)).toBe("es");
    expect(resolveLocale("fr")).toBe("es");
  });

  it("asks the model for Spanish content when the UI is Spanish", async () => {
    const { router, captured } = capturingRouter(
      '{"activity":"Vivienda compartida","targetAudience":["Jóvenes profesionales"]}',
    );
    const result = await interpretWebsite(
      {
        url: "https://moonsharedliving.com",
        title: "Moon",
        description: "Shared living",
        headings: ["Shared living spaces"],
        paragraphs: ["Connecting people and homes"],
        links: [],
      },
      router,
      "es",
    );
    expect(captured.system).toContain("Spanish (español)");
    expect(result.activity).toBe("Vivienda compartida");
  });

  it("asks the model for English content when the UI is English", async () => {
    const { router, captured } = capturingRouter('{"activity":"Shared living"}');
    const result = await interpretDescription(
      "Estoy creando una plataforma de vivienda compartida.",
      router,
      "en",
      "Moon",
    );
    expect(captured.system).toContain("English");
    expect(result.activity).toBe("Shared living");
  });

  it("states the locale rule explicitly in the prompt", () => {
    expect(localeInstruction("es")).toContain("Spanish");
    expect(localeInstruction("en")).toContain("English");
    expect(localeInstruction("es")).toContain("Never mix languages");
  });
});
