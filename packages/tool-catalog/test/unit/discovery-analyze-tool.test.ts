import { describe, it, expect } from "vitest";
import {
  buildEmptyCompanyDNA,
  buildEmptyFounderBrain,
  createMinimalConfidence,
} from "@departify/business-discovery";
import { createDiscoveryAnalyzeToolDefinition } from "../../src/index.js";

interface DiscoveryAnalyzeOutputShape {
  readonly gaps: { readonly gaps: readonly unknown[] };
  readonly questions: readonly unknown[];
  readonly completeness: {
    readonly companyDna: number;
    readonly founderBrain: number;
    readonly overall: number;
  };
  readonly meetsMinimumRequirements: boolean;
}

/**
 * The tool's executor follows the Tool Runtime contract:
 * `executor(context, args, signal)`.
 */
const context = {
  toolId: "discovery.analyze",
  toolVersion: "1.0.0",
  requestId: "req_discovery_001",
};

async function runTool(
  args: { companyDna: unknown; founderBrain?: unknown; options?: unknown },
): Promise<DiscoveryAnalyzeOutputShape> {
  const tool = createDiscoveryAnalyzeToolDefinition();
  return (await tool.executor!(
    context,
    args as never,
    {} as AbortSignal,
  )) as unknown as DiscoveryAnalyzeOutputShape;
}

describe("discovery.analyze Tool", () => {
  it("detects all gaps in an empty Company DNA", async () => {
    const output = await runTool({ companyDna: buildEmptyCompanyDNA("org-123") });

    expect(output.gaps.gaps.length).toBeGreaterThan(0);
    expect(output.meetsMinimumRequirements).toBe(false);
  });

  it("reduces gaps when DNA is populated", async () => {
    const dna = buildEmptyCompanyDNA("org-123");
    const populated = {
      ...dna,
      mission: {
        statement: "To make the world better",
        confidence: createMinimalConfidence("user_input"),
      },
    };
    const emptyResult = await runTool({ companyDna: dna });
    const populatedResult = await runTool({ companyDna: populated });

    expect(populatedResult.gaps.gaps.length).toBeLessThan(
      emptyResult.gaps.gaps.length,
    );
  });

  it("includes Founder Brain gaps only when a brain is supplied", async () => {
    const dna = buildEmptyCompanyDNA("org-123");
    const withoutBrain = await runTool({ companyDna: dna });
    const withBrain = await runTool({
      companyDna: dna,
      founderBrain: buildEmptyFounderBrain("org-123"),
    });

    expect(withBrain.gaps.gaps.length).toBeGreaterThan(
      withoutBrain.gaps.gaps.length,
    );
  });

  it("generates questions for detected gaps", async () => {
    const output = await runTool({ companyDna: buildEmptyCompanyDNA("org-123") });

    expect(output.questions.length).toBeGreaterThan(0);
  });

  it("computes the completeness summary", async () => {
    const output = await runTool({ companyDna: buildEmptyCompanyDNA("org-123") });

    expect(output.completeness.overall).toBe(0);
    expect(typeof output.completeness.companyDna).toBe("number");
    expect(typeof output.completeness.founderBrain).toBe("number");
  });

  it("honours question generation options", async () => {
    const restricted = await runTool({
      companyDna: buildEmptyCompanyDNA("org-123"),
      options: { maxTotalQuestions: 1 },
    });

    expect(restricted.questions.length).toBeLessThanOrEqual(1);
  });

  it("exposes deterministic capabilities and requires read.private scope", () => {
    const tool = createDiscoveryAnalyzeToolDefinition();
    expect(tool.id).toBe("discovery.analyze");
    expect(tool.capabilities).toContain("deterministic");
    expect(tool.capabilities).toContain("side_effect_free");
    expect(tool.requiredScopes).toContain("read.private");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });
});
