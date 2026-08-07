import { describe, it, expect } from "vitest";
import {
  extractHtml,
  buildRawDataFromInterpretation,
} from "../src/customer-zero/web-analysis.js";

describe("extractHtml", () => {
  it("extracts title, description, headings and paragraphs from real HTML", () => {
    const html = `
      <!doctype html><html><head>
        <title>La Casa del Pan — Panadería artesanal</title>
        <meta name="description" content="Pan artesanal horneado cada mañana en Madrid.">
      </head><body>
        <nav>Home About</nav>
        <h1>La Casa del Pan</h1>
        <h2>Pan de masa madre</h2>
        <p>Horneamos pan con harinas ecológicas cada mañana.</p>
        <p>Servimos a cafeterías de Madrid y Barcelona.</p>
        <footer>Contacto</footer>
      </body></html>`;

    const extracted = extractHtml(html, "https://lacasadelpan.example");

    expect(extracted.title).toBe("La Casa del Pan — Panadería artesanal");
    expect(extracted.description).toContain("Pan artesanal");
    expect(extracted.headings).toContain("La Casa del Pan");
    expect(extracted.headings).toContain("Pan de masa madre");
    expect(extracted.paragraphs).toHaveLength(2);
    expect(extracted.paragraphs[0]).toContain("harinas ecológicas");
    // Nav and footer noise is stripped.
    expect(extracted.paragraphs.join(" ")).not.toContain("Contacto");
  });

  it("handles HTML without meta description gracefully", () => {
    const extracted = extractHtml("<html><head><title>Solo título</title></head><body></body></html>", "https://x.example");
    expect(extracted.title).toBe("Solo título");
    expect(extracted.description).toBe("");
  });
});

describe("buildRawDataFromInterpretation", () => {
  it("maps interpreted facts into DNA-shaped rawData", () => {
    const rawData: Record<string, unknown> = buildRawDataFromInterpretation({
      companyName: "MOON Shared Living",
      mission: "Co-living compartido en Barcelona y Madrid",
      market: "co-living",
      products: ["Habitación en piso compartido"],
      targetAudience: ["Nómadas digitales", "Jóvenes profesionales"],
      tone: ["cercano", "moderno"],
      positioning: "Co-living premium con comunidad gestionada",
    });

    const products = rawData.products as readonly { name: string }[];
    const mission = rawData.mission as { statement: string; confidence: { source: string } };
    expect(rawData.mission).toMatchObject({ statement: "Co-living compartido en Barcelona y Madrid" });
    expect(rawData.market).toMatchObject({ industry: "co-living", competition: "medium" });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: "Habitación en piso compartido" });
    expect(rawData.idealCustomer).toMatchObject({
      demographics: ["Nómadas digitales", "Jóvenes profesionales"],
    });
    expect(rawData.tone).toMatchObject({ personality: ["cercano", "moderno"] });
    // Website confidence source.
    expect(mission.confidence.source).toBe("website");
  });

  it("returns an empty object when nothing was interpreted", () => {
    expect(buildRawDataFromInterpretation({})).toEqual({});
  });
});
