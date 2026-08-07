import { describe, it, expect } from "vitest";
import {
  produceMarketingDiagnosis,
  detectGoalCategory,
  MARKETING_CAPABILITIES,
  MARKETING_SPECIALISTS,
  SOLUTION_CATALOGS,
  buildCapabilityMap,
  formTeam,
  analyzeCapabilityGaps,
  type MarketingDiagnosisInput,
} from "../src/index.js";

describe("detectGoalCategory", () => {
  it("detects conseguir_clientes", () => {
    expect(detectGoalCategory("Quiero conseguir 20 clientes nuevos")).toBe(
      "conseguir_clientes",
    );
    expect(detectGoalCategory("captar clientes")).toBe("conseguir_clientes");
  });

  it("detects vender_mas", () => {
    expect(detectGoalCategory("Quiero vender más")).toBe("vender_mas");
    expect(detectGoalCategory("aumentar ingresos")).toBe("vender_mas");
  });

  it("detects dar_a_conocer", () => {
    expect(detectGoalCategory("dar a conocer mi marca")).toBe("dar_a_conocer");
    expect(detectGoalCategory("visibilidad")).toBe("dar_a_conocer");
  });

  it("detects lanzar_negocio", () => {
    expect(detectGoalCategory("lanzar mi negocio")).toBe("lanzar_negocio");
  });

  it("defaults to otro", () => {
    expect(detectGoalCategory("organizar mejor")).toBe("otro");
  });
});

describe("produceMarketingDiagnosis", () => {
  const moonInput: MarketingDiagnosisInput = {
    companyName: "MoOn Shared Living",
    goal: "Quiero conseguir los primeros 20 clientes en España",
    locale: "es",
    country: "España",
    companySize: "solo yo",
    hasWebsite: true,
    description: "Co-living y vivienda compartida para nómadas digitales",
    products: [
      { name: "Habitaciones en Barcelona", description: "Co-living spaces" },
    ],
    connectedTools: [],
    declaredTools: [],
    unmappedTools: [],
    discoveryGaps: [],
  };

  it("produce a diagnosis using real Company DNA", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);

    expect(diagnosis.companyName).toBe("MoOn Shared Living");
    expect(diagnosis.goal).toBe("Quiero conseguir los primeros 20 clientes en España");

    expect(diagnosis.whatTheCeoWants).toContain("MoOn");
    expect(diagnosis.whatTheCeoWants).toContain("España");

    expect(diagnosis.whereTheyAreNow).toContain("presencia web");

    expect(diagnosis.opportunities.length).toBeGreaterThan(0);
    const firstOpp = diagnosis.opportunities[0]!;
    expect(firstOpp.title).toBeTruthy();
    expect(firstOpp.description).toBeTruthy();
    expect(firstOpp.priority).toBeGreaterThan(0);

    expect(diagnosis.neededCapabilities.length).toBeGreaterThan(0);
    expect(diagnosis.whatCanBeDoneNow.length).toBeGreaterThan(0);
    expect(diagnosis.whatToDoFirst).toBeTruthy();
  });

  it("diagnosis differs for a different company (anti-generic test)", () => {
    const mailchimpInput: MarketingDiagnosisInput = {
      companyName: "Mailchimp",
      goal: "Mejorar SEO y visibilidad online",
      locale: "es",
      country: "Estados Unidos",
      companySize: "200+",
      hasWebsite: true,
      connectedTools: ["gmail", "hubspot", "google_analytics"],
      declaredTools: [],
      unmappedTools: [],
      discoveryGaps: [],
    };

    const moonDiag = produceMarketingDiagnosis(moonInput, null);
    const mailchimpDiag = produceMarketingDiagnosis(mailchimpInput, null);

    expect(moonDiag.companyName).not.toBe(mailchimpDiag.companyName);
    expect(moonDiag.whatTheCeoWants).not.toBe(mailchimpDiag.whatTheCeoWants);
    expect(moonDiag.neededSpecialistRoles).not.toEqual(
      mailchimpDiag.neededSpecialistRoles,
    );

    const moonCaps = moonDiag.neededCapabilities.map((g) => g.capability);
    const mailchimpCaps = mailchimpDiag.neededCapabilities.map((g) => g.capability);
    expect(moonCaps).not.toEqual(mailchimpCaps);
  });

  it("finds market_local finding for Spain", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);
    const marketFinding = diagnosis.whatSeemsMissing.find(
      (f) => f.category === "mercado_local",
    );
    expect(marketFinding).toBeTruthy();
    expect(marketFinding?.evidence).toContain("País declarado: España");
  });

  it("detects equipo_reducido for solo founder", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);
    const teamFinding = diagnosis.whatSeemsMissing.find(
      (f) => f.category === "equipo_reducido",
    );
    expect(teamFinding).toBeTruthy();
  });

  it("detects sin_herramientas when no tools connected", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);
    const toolFinding = diagnosis.whatSeemsMissing.find(
      (f) => f.category === "sin_herramientas",
    );
    expect(toolFinding).toBeTruthy();
  });

  it("detects blocked external capabilities", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);
    const blocked = diagnosis.whatIsBlocked;
    const emailBlocked = blocked.find((b) => b.includes("email") || b.includes("correo"));
    expect(emailBlocked).toBeTruthy();
  });

  it("opportunities reference real capabilities", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);
    for (const opp of diagnosis.opportunities) {
      for (const cap of opp.neededCapabilities) {
        const exists = MARKETING_CAPABILITIES.some((c) => c.id === cap);
        expect(exists).toBe(true);
      }
    }
  });

  it("whatNotWorthDoingYet is reasonable for solo founder", () => {
    const diagnosis = produceMarketingDiagnosis(moonInput, null);
    const notWorth = diagnosis.whatNotWorthDoingYet;
    expect(notWorth.length).toBeGreaterThan(0);
    expect(
      notWorth.some((n) => n.includes("pago") || n.includes("orgánico")),
    ).toBe(true);
  });
});

describe("formTeam", () => {
  it("forms team based on goal (conseguir clientes)", () => {
    const result = formTeam(
      "Quiero conseguir los primeros 20 clientes en España",
      ["spec_acquisition", "spec_content", "spec_growth"],
      "es",
      [],
    );

    expect(result.director.name).toBe("Elvira");
    expect(result.director.role).toBe("Jefa de Marketing");
    expect(result.specialists.length).toBe(3);
    expect(result.specialists.map((s) => s.status).every((st) => st === "preparando" || st === "esperando")).toBe(true);
    expect(result.message).toContain("equipo");
  });

  it("forms different team for SEO goal", () => {
    const clientesResult = formTeam(
      "Conseguir clientes",
      ["spec_acquisition", "spec_content", "spec_growth"],
      "es",
      [],
    );
    const seoResult = formTeam(
      "Mejorar SEO",
      ["spec_content", "spec_seo", "spec_growth"],
      "es",
      [],
    );

    expect(clientesResult.specialists.map((s) => s.id)).not.toEqual(
      seoResult.specialists.map((s) => s.id),
    );
  });

  it("respects locale (English)", () => {
    const result = formTeam(
      "Get customers",
      ["spec_acquisition"],
      "en",
      [],
    );
    expect(result.director.role).toBe("Head of Marketing");
    expect(result.message).toContain("team");
  });
});

describe("analyzeCapabilityGaps", () => {
  it("identifies available and unavailable capabilities", () => {
    const gaps = [
      { capability: "market_research", name: "market_research", reason: "", blocked: false },
      {
        capability: "email_marketing",
        name: "email_marketing",
        reason: "Needs email",
        blocked: true,
        toolCapability: "email.send",
      },
    ];

    const result = analyzeCapabilityGaps(
      gaps,
      SOLUTION_CATALOGS,
      [],
      new Set(),
      "solo yo",
      "es",
    );

    expect(result.availableCapabilities).toContain("market_research");
    expect(result.unavailableCapabilities).toContain("email_marketing");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("recommends Gmail for solo founder (free)", () => {
    const gaps = [
      {
        capability: "email_marketing",
        name: "email_marketing",
        reason: "Needs email",
        blocked: true,
        toolCapability: "email.send",
      },
    ];

    const result = analyzeCapabilityGaps(
      gaps,
      SOLUTION_CATALOGS,
      [],
      new Set(),
      "solo yo",
      "es",
    );

    const rec = result.recommendations[0];
    expect(rec).toBeTruthy();
    expect(rec?.solution.tier).toBe("free");
    expect(rec?.solution.toolId).toBe("gmail");
  });

  it("prioritizes existing tool", () => {
    const gaps = [
      {
        capability: "email_marketing",
        name: "email_marketing",
        reason: "Needs email",
        blocked: true,
        toolCapability: "email.send",
      },
    ];

    const result = analyzeCapabilityGaps(
      gaps,
      SOLUTION_CATALOGS,
      [],
      new Set(["outlook"]),
      "pyme",
      "es",
    );

    const rec = result.recommendations[0];
    expect(rec).toBeTruthy();
    expect(rec?.solution.toolId).toBe("outlook");
  });

  it("does not recommend commercial for solo founder when free exists", () => {
    const gaps = [
      {
        capability: "email_marketing",
        name: "email_marketing",
        reason: "Needs email",
        blocked: true,
        toolCapability: "email.send",
      },
    ];

    const result = analyzeCapabilityGaps(
      gaps,
      SOLUTION_CATALOGS,
      [],
      new Set(),
      "solo yo",
      "es",
    );

    const rec = result.recommendations[0];
    expect(rec).toBeTruthy();
    expect(rec?.solution.toolId).not.toBe("outlook");
  });

  it("recommends freemium for CRM for solo founder", () => {
    const gaps = [
      {
        capability: "lead_management",
        name: "lead_management",
        reason: "Needs CRM",
        blocked: true,
        toolCapability: "crm.contacts",
      },
    ];

    const result = analyzeCapabilityGaps(
      gaps,
      SOLUTION_CATALOGS,
      [],
      new Set(),
      "solo yo",
      "es",
    );

    const rec = result.recommendations[0];
    expect(rec).toBeTruthy();
    expect(["freemium", "free", "open_source"]).toContain(rec?.solution.tier);
  });
});

describe("capability catalog", () => {
  it("all specialists have valid capabilities", () => {
    const capMap = buildCapabilityMap();
    for (const spec of MARKETING_SPECIALISTS) {
      for (const capId of spec.capabilities) {
        expect(
          capMap.has(capId),
          `Specialist ${spec.id} references unknown capability ${capId}`,
        ).toBe(true);
      }
    }
  });

  it("all specialist skills reference valid capabilities", () => {
    const capMap = buildCapabilityMap();
    for (const spec of MARKETING_SPECIALISTS) {
      for (const skill of spec.skills) {
        for (const capId of skill.capabilities) {
          expect(
            capMap.has(capId),
            `Skill ${skill.id} of ${spec.id} references unknown capability ${capId}`,
          ).toBe(true);
        }
      }
    }
  });

  it("capabilities have valid kinds", () => {
    for (const cap of MARKETING_CAPABILITIES) {
      expect(["internal", "external"]).toContain(cap.kind);
      if (cap.kind === "external") {
        expect(cap.toolCapability).toBeTruthy();
        expect(cap.requiresTool).toBe(true);
      }
    }
  });
});

describe("anti-hardcode", () => {
  it("diagnosis differs for real different companies (MoOn vs Spotify-like)", () => {
    const moonInput: MarketingDiagnosisInput = {
      companyName: "MoOn Shared Living",
      goal: "Quiero conseguir los primeros 20 clientes en España",
      locale: "es",
      country: "España",
      companySize: "solo yo",
      hasWebsite: true,
      connectedTools: [],
      declaredTools: [],
      unmappedTools: [],
      discoveryGaps: [],
    };

    const spotifyInput: MarketingDiagnosisInput = {
      companyName: "Spotify",
      goal: "Dar a conocer la marca en el mercado latinoamericano",
      locale: "es",
      country: "Suecia",
      companySize: "200+",
      hasWebsite: true,
      connectedTools: ["gmail", "hubspot", "google_analytics", "google_ads"],
      declaredTools: [],
      unmappedTools: [],
      discoveryGaps: [],
    };

    const moonDiag = produceMarketingDiagnosis(moonInput, null);
    const spotifyDiag = produceMarketingDiagnosis(spotifyInput, null);

    expect(moonDiag.companyName).not.toBe(spotifyDiag.companyName);
    expect(moonDiag.whatTheCeoWants).not.toBe(spotifyDiag.whatTheCeoWants);

    const moonRoles = [...moonDiag.neededSpecialistRoles].sort();
    const spotifyRoles = [...spotifyDiag.neededSpecialistRoles].sort();
    expect(moonRoles).not.toEqual(spotifyRoles);

    const moonBlocked = moonDiag.whatIsBlocked.length;
    const spotifyBlocked = spotifyDiag.whatIsBlocked.length;
    expect(moonBlocked).toBeGreaterThan(spotifyBlocked);
  });
});
