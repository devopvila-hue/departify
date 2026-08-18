/**
 * SEO Result — canonical contract.
 *
 * Every SEO audit result in Departify carries the same shape:
 *
 *   {
 *     url:                string                   — audited URL (normalized)
 *     fetchedAt:          ISO date                 — when the page was fetched
 *     page:               SeoAuditPageSummary      — observed page signals
 *     issues:             SeoIssue[]               — issues with evidence
 *     correlation:        { website, repository?, sections[] }
 *     plan:               SeoResolutionPlan        — Ahora / Después / Optimización
 *     tasks:              SeoResolutionTask[]      — derived DepartmentTask payload
 *     source:             'seo.audit.website'
 *     producedByCapability: 'seo.audit.website'
 *
 * The Result is stored on `DepartmentResult.data` so the Portal can render
 * it without re-parsing the markdown body. The markdown body is preserved
 * for the chat reply and any non-React consumer.
 *
 * Every field is "observed" (data from the real page / real repo) unless
 * the field name explicitly says "inferred" or "recommended". The chat
 * pipeline and the Portal render MUST honour that contract: an inference
 * is never presented as a fact.
 */

export type SeoIssueSeverity = "critical" | "important" | "opportunity";

export type SeoResolutionPhase = "now" | "next" | "later";

export interface SeoObservedPage {
  readonly title: string;
  readonly description: string;
  readonly canonical: string | null;
  readonly robots: string | null;
  readonly h1: readonly string[];
  readonly h2Count: number;
  readonly h3Count: number;
  readonly internalLinksChecked: number;
  readonly brokenInternalLinks: number;
  readonly imagesWithoutAlt: number;
  readonly structuredDataBlocks: number;
  readonly socialMetadata: readonly string[];
  readonly sitemap: "available" | "missing" | "unavailable";
}

export interface SeoIssue {
  readonly id: string;
  readonly severity: SeoIssueSeverity;
  readonly title: string;
  readonly description: string;
  /** Observed verbatim evidence from the audit. Never invented. */
  readonly evidence: string;
  /** Concrete next step — recommendation, not fact. */
  readonly recommendation: string;
  /** Issue phase in the deterministic resolution plan. */
  readonly phase: SeoResolutionPhase;
  /** Optional repository file hints (observed from inspectGithubRepository). */
  readonly repositoryFiles: readonly string[];
  /** Honest provenance tags the Portal uses to render OBSERVADO / INFERENCIA / RECOMENDACIÓN distinctly. */
  readonly provenance: {
    readonly observedFromWeb: true;
    readonly observedFromRepo: boolean;
    readonly inferred: boolean;
    readonly recommended: true;
  };
}

export interface SeoCorrelationSection {
  readonly issueId: string;
  readonly title: string;
  readonly observedWebEvidence: string;
  readonly observedRepositoryFiles: readonly string[];
  readonly inference: string;
  readonly recommendation: string;
}

export interface SeoCorrelation {
  readonly website: string;
  readonly repository: {
    readonly fullName: string;
    readonly htmlUrl: string;
    readonly defaultBranch: string;
  } | null;
  readonly sections: readonly SeoCorrelationSection[];
}

export interface SeoPlanBucket {
  readonly phase: SeoResolutionPhase;
  readonly title: string;
  readonly summary: string;
  readonly issueIds: readonly string[];
}

export interface SeoResolutionPlan {
  readonly buckets: readonly SeoPlanBucket[];
  /** Total counts for the dashboard header. */
  readonly totals: {
    readonly critical: number;
    readonly important: number;
    readonly opportunity: number;
  };
}

export interface SeoResolutionTaskPayload {
  readonly title: string;
  readonly summary: string;
  readonly capability: "seo.audit.website" | "seo.repository.read";
  readonly toolId:
    | "departify.seo.audit"
    | "departify.seo.repository.inspect"
    | "departify.seo.repository.list";
  readonly severity: SeoIssueSeverity;
  readonly phase: SeoResolutionPhase;
  readonly issueIds: readonly string[];
}

export interface SeoResultContract {
  readonly contract: "seo.audit.result";
  readonly version: 1;
  readonly url: string;
  readonly fetchedAt: string;
  readonly page: SeoObservedPage;
  readonly issues: readonly SeoIssue[];
  readonly correlation: SeoCorrelation;
  readonly plan: SeoResolutionPlan;
  readonly tasks: readonly SeoResolutionTaskPayload[];
  /** IDs of the DepartmentTask rows persisted for the derived plan
   *  buckets. The Portal uses these IDs to look up live task state
   *  (queued / running / completed) without re-fetching the contract. */
  readonly derivedTaskIds: readonly string[];
  readonly source: "seo.audit.website";
  readonly producedByCapability: "seo.audit.website";
}

/* ----------------------------------------------------------------------------
 * Builders
 * --------------------------------------------------------------------------*/

/**
 * Decide the deterministic resolution phase for an issue id.
 *
 * The phases are derived from the issue semantics, never from the LLM:
 *
 *   now    — indexability blockers (noindex, broken internal links,
 *            missing sitemap)
 *   next   — discoverability + content shape (missing title, description,
 *            canonical, missing H1, multiple H1, long title)
 *   later  — opportunistic improvements (alt text, structured data
 *            expansion, social metadata)
 */
export function phaseForIssueId(issueId: string): SeoResolutionPhase {
  if (issueId === "noindex" || issueId === "broken-links" || issueId === "missing-sitemap") {
    return "now";
  }
  if (
    issueId === "missing-title" ||
    issueId === "missing-description" ||
    issueId === "missing-canonical" ||
    issueId === "long-title" ||
    issueId === "missing-h1" ||
    issueId === "multiple-h1"
  ) {
    return "next";
  }
  return "later";
}

/**
 * Group multiple issues into a single actionable DepartmentTask.
 * Returns the title and a list of contributing issue ids.
 */
export function groupIssuesIntoTask(issueIds: readonly string[]): {
  readonly title: string;
  readonly summary: string;
} {
  const set = new Set(issueIds);
  if (
    set.has("noindex") ||
    set.has("missing-sitemap") ||
    set.has("broken-links")
  ) {
    return {
      title: "Corregir indexación",
      summary:
        "Asegurar que los buscadores pueden rastrear e indexar la página: directiva robots, sitemap.xml y enlaces internos sin errores.",
    };
  }
  if (
    set.has("missing-title") ||
    set.has("missing-description") ||
    set.has("missing-canonical") ||
    set.has("long-title")
  ) {
    return {
      title: "Corregir metadata",
      summary:
        "Definir title, description y canonical para que cada página se presente correctamente en los resultados de búsqueda.",
    };
  }
  if (set.has("missing-h1") || set.has("multiple-h1")) {
    return {
      title: "Corregir estructura de encabezados",
      summary:
        "Asegurar una jerarquía de encabezados con un único H1 descriptivo por página.",
    };
  }
  if (set.has("images-without-alt")) {
    return {
      title: "Añadir texto alternativo a imágenes",
      summary:
        "Describir todas las imágenes mediante el atributo alt para mejorar accesibilidad y comprensión del contenido.",
    };
  }
  return {
    title: "Trabajo SEO derivado de la auditoría",
    summary: "Acciones recomendadas detectadas durante la auditoría.",
  };
}

/**
 * Map of issue id → short, action-oriented recommendation text. Used to
 * produce the `recommendation` field on every SeoIssue. The recommendation
 * is deterministic — never generated by an LLM.
 */
const RECOMMENDATION_FOR_ISSUE: Readonly<Record<string, string>> = {
  "missing-title":
    "Añadir la etiqueta <title> con un texto descriptivo único por página (≤ 60 caracteres).",
  "long-title":
    "Recortar el title actual para que no se trunque en las SERPs.",
  "missing-description":
    "Añadir la meta description con un resumen que invite al clic (≤ 160 caracteres).",
  "missing-canonical":
    "Establecer <link rel='canonical'> apuntando a la URL canónica de la página.",
  "missing-h1":
    "Añadir un único encabezado H1 descriptivo en la página.",
  "multiple-h1":
    "Reducir a un único H1; los demás encabezados deben ser H2/H3.",
  "noindex":
    "Quitar la directiva noindex de la página (o dejarla solo donde sea estrictamente necesario).",
  "broken-links":
    "Corregir los enlaces internos que no responden para no romper la navegación ni el rastreo.",
  "images-without-alt":
    "Añadir atributo alt descriptivo a cada imagen sin alt.",
  "missing-sitemap":
    "Generar o exponer el sitemap.xml en la raíz del sitio.",
};

/**
 * Build the canonical SEO Result contract from the audit report and
 * optional repository inspection. The output is what the Portal renders.
 */
export function buildSeoResultContract(input: {
  readonly audit: {
    readonly url: string;
    readonly fetchedAt: string;
    readonly page: {
      readonly title: string;
      readonly description: string;
      readonly canonical: string | null;
      readonly robots: string | null;
      readonly headings: Readonly<Record<"h1" | "h2" | "h3", readonly string[]>>;
      readonly internalUrls: readonly string[];
      readonly brokenUrls: readonly string[];
      readonly imagesWithoutAlt: number;
      readonly structuredDataBlocks: number;
      readonly socialMetadata: readonly string[];
      readonly sitemap: "available" | "missing" | "unavailable";
    };
    readonly issues: ReadonlyArray<{
      readonly id: string;
      readonly priority: "critical" | "important" | "opportunity";
      readonly title: string;
      readonly impact: string;
      readonly evidence: string;
    }>;
  };
  readonly repository?: {
    readonly fullName: string;
    readonly htmlUrl: string;
    readonly defaultBranch: string;
  } | null;
  readonly repositoryFiles?: readonly string[];
  readonly issueFileHints?: Readonly<Record<string, readonly string[]>>;
}): SeoResultContract {
  // Issue ids grouped by phase.
  const issuesByPhase: Record<SeoResolutionPhase, string[]> = {
    now: [],
    next: [],
    later: [],
  };
  const issues: SeoIssue[] = [];
  for (const raw of input.audit.issues) {
    const phase = phaseForIssueId(raw.id);
    issuesByPhase[phase].push(raw.id);
    const files = input.issueFileHints?.[raw.id] ?? [];
    issues.push({
      id: raw.id,
      severity: raw.priority,
      title: raw.title,
      description: raw.impact,
      evidence: raw.evidence,
      recommendation: RECOMMENDATION_FOR_ISSUE[raw.id]
        ?? `Atender "${raw.title}" — ${raw.impact}.`,
      phase,
      repositoryFiles: files,
      provenance: {
        observedFromWeb: true,
        observedFromRepo: files.length > 0,
        inferred: false,
        recommended: true,
      },
    });
  }

  const plan: SeoResolutionPlan = {
    buckets: [
      {
        phase: "now",
        title: "Ahora",
        summary: "Problemas críticos que bloquean la indexación y el rastreo.",
        issueIds: issuesByPhase.now,
      },
      {
        phase: "next",
        title: "Después",
        summary: "Problemas importantes de metadata y estructura de la página.",
        issueIds: issuesByPhase.next,
      },
      {
        phase: "later",
        title: "Optimización",
        summary: "Oportunidades detectadas para mejorar accesibilidad y presentación.",
        issueIds: issuesByPhase.later,
      },
    ],
    totals: {
      critical: issues.filter((i) => i.severity === "critical").length,
      important: issues.filter((i) => i.severity === "important").length,
      opportunity: issues.filter((i) => i.severity === "opportunity").length,
    },
  };

  // Group issues into tasks per phase bucket. One task per phase that
  // has issues, with a single actionable title covering the bucket.
  const tasks: SeoResolutionTaskPayload[] = [];
  for (const bucket of plan.buckets) {
    if (bucket.issueIds.length === 0) continue;
    const group = groupIssuesIntoTask(bucket.issueIds);
    tasks.push({
      title: `${group.title} (${bucket.issueIds.length})`,
      summary: group.summary,
      capability: "seo.audit.website",
      toolId: "departify.seo.audit",
      severity:
        bucket.phase === "now"
          ? "critical"
          : bucket.phase === "next"
            ? "important"
            : "opportunity",
      phase: bucket.phase,
      issueIds: bucket.issueIds,
    });
  }

  // Build correlation (observado/inferencia/recomendación sections).
  const correlationSections: SeoCorrelationSection[] = [];
  if (input.repository && input.issueFileHints) {
    for (const issue of issues) {
      if (issue.repositoryFiles.length === 0) continue;
      correlationSections.push({
        issueId: issue.id,
        title: issue.title,
        observedWebEvidence: issue.evidence,
        observedRepositoryFiles: issue.repositoryFiles,
        inference:
          `El hallazgo "${issue.title}" se ha observado en la web y los archivos ${issue.repositoryFiles
            .map((file) => `\`${file}\``)
            .join(", ")} son los candidatos más probables del repositorio donde se origina el marcado correspondiente.`,
        recommendation: issue.recommendation,
      });
    }
  }

  const correlation: SeoCorrelation = {
    website: input.audit.url,
    repository: input.repository
      ? {
          fullName: input.repository.fullName,
          htmlUrl: input.repository.htmlUrl,
          defaultBranch: input.repository.defaultBranch,
        }
      : null,
    sections: correlationSections,
  };

  return {
    contract: "seo.audit.result",
    version: 1,
    url: input.audit.url,
    fetchedAt: input.audit.fetchedAt,
    page: {
      title: input.audit.page.title,
      description: input.audit.page.description,
      canonical: input.audit.page.canonical,
      robots: input.audit.page.robots,
      h1: input.audit.page.headings.h1,
      h2Count: input.audit.page.headings.h2.length,
      h3Count: input.audit.page.headings.h3.length,
      internalLinksChecked: input.audit.page.internalUrls.length,
      brokenInternalLinks: input.audit.page.brokenUrls.length,
      imagesWithoutAlt: input.audit.page.imagesWithoutAlt,
      structuredDataBlocks: input.audit.page.structuredDataBlocks,
      socialMetadata: input.audit.page.socialMetadata,
      sitemap: input.audit.page.sitemap,
    },
    issues,
    correlation,
    plan,
    tasks,
    derivedTaskIds: [], // Filled by the chat pipeline after persistence.
    source: "seo.audit.website",
    producedByCapability: "seo.audit.website",
  };
}

/**
 * Render the canonical contract as a chat-friendly markdown summary.
 * The Portal prefers the structured `data.seoContract` payload — this
 * markdown is the fallback that makes the result readable anywhere.
 *
 * The Customer Zero honesty contract is preserved here: every line is
 * tagged OBSERVADO / INFERENCIA / RECOMENDACIÓN so the chat never
 * presents an inference as a fact.
 */
export function renderSeoResultMarkdown(
  contract: SeoResultContract,
  isEs: boolean,
): string {
  const lines: string[] = [];
  lines.push(`## Auditoría SEO`);
  lines.push(`Web revisada: ${contract.url}`);
  lines.push(`Fecha: ${contract.fetchedAt}`);
  lines.push(``);
  lines.push(`### Observado`);
  lines.push(`- title: ${contract.page.title || "(vacío)"}`);
  lines.push(`- description: ${contract.page.description || "(vacío)"}`);
  lines.push(`- canonical: ${contract.page.canonical ?? "(no detectado)"}`);
  lines.push(`- robots: ${contract.page.robots ?? "(no detectado)"}`);
  lines.push(`- H1 (${contract.page.h1.length}): ${contract.page.h1.slice(0, 5).join(" | ") || "(sin H1)"}`);
  lines.push(`- H2 (${contract.page.h2Count}) / H3 (${contract.page.h3Count})`);
  lines.push(`- Enlaces internos revisados: ${contract.page.internalLinksChecked}`);
  lines.push(`- Enlaces internos rotos: ${contract.page.brokenInternalLinks}`);
  lines.push(`- Imágenes sin alt: ${contract.page.imagesWithoutAlt}`);
  lines.push(`- Bloques de datos estructurados: ${contract.page.structuredDataBlocks}`);
  lines.push(`- Metadata social presente: ${contract.page.socialMetadata.join(", ") || "(ninguna)"}`);
  lines.push(`- sitemap.xml: ${contract.page.sitemap}`);
  lines.push(``);
  lines.push(`### Problemas (${contract.issues.length})`);
  lines.push(`- Críticos: ${contract.plan.totals.critical}`);
  lines.push(`- Importantes: ${contract.plan.totals.important}`);
  lines.push(`- Oportunidades: ${contract.plan.totals.opportunity}`);
  lines.push(``);
  lines.push(`### Plan de resolución`);
  for (const bucket of contract.plan.buckets) {
    if (bucket.issueIds.length === 0) continue;
    lines.push(`- **${bucket.title}** — ${bucket.summary} (${bucket.issueIds.length} problema${bucket.issueIds.length === 1 ? "" : "s"})`);
  }
  lines.push(``);
  lines.push(`### Lista priorizada`);
  for (const issue of contract.issues) {
    const sev = issue.severity.toUpperCase();
    lines.push(`- **${sev}** — ${issue.title}`);
    lines.push(`  - **OBSERVADO (web)**: ${issue.evidence}`);
    if (issue.repositoryFiles.length > 0) {
      lines.push(`  - **OBSERVADO (repo)**: ${issue.repositoryFiles.map((file) => `\`${file}\``).join(", ")}`);
    }
    lines.push(`  - **RECOMENDACIÓN**: ${issue.recommendation}`);
  }
  if (contract.correlation.sections.length > 0) {
    lines.push(``);
    lines.push(renderSeoCorrelationContractMarkdown(contract.correlation));
  }
  void isEs;
  return lines.join("\n");
}

function renderSeoCorrelationContractMarkdown(correlation: SeoCorrelation): string {
  const lines: string[] = [];
  lines.push(`### Web ↔ Repositorio — correlación`);
  lines.push(`Web auditada: ${correlation.website}`);
  if (correlation.repository) {
    lines.push(
      `Repositorio: ${correlation.repository.fullName} (${correlation.repository.htmlUrl}, branch \`${correlation.repository.defaultBranch}\`)`,
    );
  } else {
    lines.push(`Repositorio: (no conectado)`);
  }
  lines.push(``);
  for (const section of correlation.sections) {
    lines.push(`#### ${section.title}  (\`${section.issueId}\`)`);
    lines.push(`- **OBSERVADO (web)**: ${section.observedWebEvidence}`);
    if (section.observedRepositoryFiles.length > 0) {
      lines.push(
        `- **OBSERVADO (repo)**: ${section.observedRepositoryFiles.map((file) => `\`${file}\``).join(", ")}`,
      );
    }
    lines.push(`- **INFERENCIA**: ${section.inference}`);
    lines.push(`- **RECOMENDACIÓN**: ${section.recommendation}`);
    lines.push(``);
  }
  return lines.join("\n");
}