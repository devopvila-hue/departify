import { describe, it, expect } from "vitest";
import type {
  CompanyDiscoveryReport,
  DiscoveryGap,
  DiscoveryQuestion,
} from "@departify/business-discovery";
import { buildEmptyCompanyDNA } from "@departify/business-discovery";
import { curateMandatoryQuestions } from "../src/customer-zero/questions.js";
import { buildAnswersRawData } from "../src/customer-zero/answers.js";

function buildReport(
  gaps: { category: string; importance: string }[],
  questions: { category: string; importance: string; priority: number }[],
): CompanyDiscoveryReport {
  return {
    organizationId: "org_test",
    sessionId: "session_test",
    metadata: {
      sessionId: "session_test",
      startedAt: new Date("2026-08-07T10:00:00Z"),
      completedAt: new Date("2026-08-07T10:00:01Z"),
      durationMs: 1000,
      sources: [],
      dataPoints: 0,
      questionsAsked: questions.length,
      questionsAnswered: 0,
    },
    companyDna: buildEmptyCompanyDNA("org_test"),
    findings: [],
    gaps: gaps.map((g) => ({
      id: `gap_${g.category}`,
      category: g.category,
      description: `Missing ${g.category}`,
      importance: g.importance,
      blockingAction: g.importance === "critical",
    })) as DiscoveryGap[],
    questions: questions.map((q) => ({
      id: `q_${q.category}`,
      gapId: `gap_${q.category}`,
      category: q.category,
      question: `English question about ${q.category}?`,
      type: "open",
      priority: q.priority,
      context: "ctx",
      importance: q.importance,
    })) as DiscoveryQuestion[],
    confidence: {
      overall: "low",
      companyDna: 0,
      founderBrain: 0,
      breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
    },
    generatedAt: new Date("2026-08-07T10:00:01Z"),
  };
}

describe("curateMandatoryQuestions", () => {
  it("returns only critical + high DNA categories, one per category, in Spanish", () => {
    const report = buildReport([], [
      { category: "mission", importance: "critical", priority: 100 },
      { category: "mission", importance: "critical", priority: 90 },
      { category: "vision", importance: "high", priority: 95 },
      { category: "services", importance: "low", priority: 60 },
      { category: "leadership_style", importance: "critical", priority: 70 },
    ]);

    const questions = curateMandatoryQuestions(report);

    // Only persistable DNA categories, no brain categories, no low importance.
    const categories = questions.map((q) => q.category);
    expect(categories).toContain("mission");
    expect(categories).toContain("vision");
    expect(categories).not.toContain("services");
    expect(categories).not.toContain("leadership_style");

    // One per category: mission appears once (highest priority variant kept).
    expect(categories.filter((c) => c === "mission")).toHaveLength(1);

    // Localized to the UI locale.
    const mission = questions.find((q) => q.category === "mission");
    expect(mission?.question).toBe("¿Cuál es la misión de tu empresa?");
    expect(questions.every((q) => /[¿¡Á-Úá-ú]/.test(q.question))).toBe(true);
  });

  it("is capped at a small focused set", () => {
    const report = buildReport(
      [],
      Array.from({ length: 15 }, (_, i) => ({
        category: `value_proposition`,
        importance: "critical" as const,
        priority: 100 - i,
      })),
    );
    // Even with many questions, only one per category is kept.
    const questions = curateMandatoryQuestions(report);
    expect(questions).toHaveLength(1);
  });

  it("returns an empty list when the report has no persistable gaps", () => {
    const report = buildReport([], [
      { category: "leadership_style", importance: "critical", priority: 70 },
      { category: "services", importance: "medium", priority: 60 },
    ]);
    expect(curateMandatoryQuestions(report)).toEqual([]);
  });
});

describe("buildAnswersRawData", () => {
  it("maps CEO answers into DNA-shaped rawData with user_input provenance", () => {
    const raw = buildAnswersRawData({
      mission: "Co-living compartido en Barcelona y Madrid",
      market: "co-living",
      values: "Comunidad, Transparencia",
      ideal_customer: "Nómadas digitales; Jóvenes profesionales",
    });

    expect(raw.mission).toMatchObject({
      statement: "Co-living compartido en Barcelona y Madrid",
      confidence: { level: "verified", source: "user_input" },
    });
    expect(raw.market).toMatchObject({ industry: "co-living" });
    expect(raw.values).toHaveLength(2);
    expect(raw.idealCustomer).toMatchObject({
      demographics: ["Nómadas digitales", "Jóvenes profesionales"],
    });
  });

  it("ignores unknown categories and empty answers", () => {
    expect(buildAnswersRawData({ not_a_category: "x", mission: "  " })).toEqual({});
  });

  it("produces structured arrays for products, strengths and objectives", () => {
    const raw = buildAnswersRawData({
      products: "Habitación, Ático",
      strengths: "Comunidad activa",
      objectives: "Llenar 20 habitaciones",
    });

    expect(raw.products).toHaveLength(2);
    expect(raw.strengths).toHaveLength(1);
    expect(raw.objectives).toHaveLength(1);
  });
});
