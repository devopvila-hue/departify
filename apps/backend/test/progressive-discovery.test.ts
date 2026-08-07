import { describe, it, expect } from "vitest";
import type {
  CompanyDiscoveryReport,
  DiscoveryQuestion,
  FindingCategory,
} from "@departify/business-discovery";
import { buildEmptyCompanyDNA } from "@departify/business-discovery";
import {
  createConversationState,
  dnaQuestionId,
  isReadyForMarketing,
  selectNextQuestion,
} from "../src/customer-zero/progressive-discovery.js";

function report(
  questions: { category: FindingCategory; importance: string }[],
): CompanyDiscoveryReport {
  return {
    organizationId: "org_test",
    sessionId: "session_test",
    metadata: {
      sessionId: "session_test",
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 1,
      sources: [],
      dataPoints: 0,
      questionsAsked: questions.length,
      questionsAnswered: 0,
    },
    companyDna: buildEmptyCompanyDNA("org_test"),
    findings: [],
    gaps: [],
    questions: questions.map((q) => ({
      id: `q_${q.category}`,
      gapId: `gap_${q.category}`,
      category: q.category,
      question: `English question about ${q.category}?`,
      type: "open",
      priority: 50,
      context: "ctx",
      importance: q.importance,
    })) as DiscoveryQuestion[],
    confidence: {
      overall: "low",
      companyDna: 0,
      founderBrain: 0,
      breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
    },
    generatedAt: new Date(),
  };
}

describe("progressive discovery", () => {
  it("asks ONE blocking business question first, in the session locale", () => {
    const state = createConversationState();
    const question = selectNextQuestion(
      report([
        { category: "ideal_customer", importance: "critical" },
        { category: "processes", importance: "low" },
      ]),
      state,
      "es",
    );
    expect(question?.id).toBe("dna:ideal_customer");
    expect(question?.weight).toBe("blocking");
    expect(question?.question).toBe("¿Quién es tu cliente ideal?");
  });

  it("localizes the same question to English", () => {
    const question = selectNextQuestion(
      report([{ category: "ideal_customer", importance: "critical" }]),
      createConversationState(),
      "en",
    );
    expect(question?.question).toBe("Who is your ideal customer?");
  });

  it("never asks optional questions", () => {
    const state = createConversationState();
    state.answered.add("ops:tools");
    state.answered.add("ops:crm");
    const question = selectNextQuestion(
      report([{ category: "processes", importance: "low" }]),
      state,
      "es",
    );
    expect(question).toBeNull();
  });

  it("skips questions already resolved by a previous answer", () => {
    const state = createConversationState();
    state.answered.add(dnaQuestionId("ideal_customer"));
    const question = selectNextQuestion(
      report([
        { category: "ideal_customer", importance: "critical" },
        { category: "value_proposition", importance: "critical" },
      ]),
      state,
      "es",
    );
    expect(question?.id).toBe("dna:value_proposition");
  });

  it("asks the tools question with visual options and an 'Otra' escape", () => {
    const state = createConversationState();
    const question = selectNextQuestion(
      report([{ category: "tone", importance: "high" }]),
      state,
      "es",
    );
    expect(question?.id).toBe("ops:tools");
    expect(question?.component).toBe("multi_choice");
    expect(question?.options).toContain("Gmail");
    expect(question?.options).toContain("Otra");
  });

  it("asks which tool when the CEO chose 'Otra'", () => {
    const state = createConversationState();
    state.pendingToolDetail = true;
    const question = selectNextQuestion(report([]), state, "es");
    expect(question?.id).toBe("ops:tool_other");
    expect(question?.component).toBe("text");
  });

  it("offers 'No utilizo CRM' as a first-class answer", () => {
    const state = createConversationState();
    state.answered.add("ops:tools");
    const question = selectNextQuestion(report([]), state, "es");
    expect(question?.id).toBe("ops:crm");
    expect(question?.options?.[0]).toBe("No utilizo CRM");
  });

  it("is ready for Marketing when nothing blocking is left", () => {
    const state = createConversationState();
    expect(
      isReadyForMarketing(
        report([{ category: "market", importance: "high" }]),
        state,
      ),
    ).toBe(true);
    expect(
      isReadyForMarketing(
        report([{ category: "value_proposition", importance: "critical" }]),
        state,
      ),
    ).toBe(false);
  });
});
