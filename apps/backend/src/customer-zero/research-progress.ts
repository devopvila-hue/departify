/**
 * Real research progress for the "Conociendo tu negocio…" screen.
 *
 * The stages are NOT decorative: each one is opened and closed by the code
 * that actually performs that work. No fake progress, no invented countdown.
 * A time estimate is only exposed once we have measured real historical
 * durations for the same stage set.
 */
import { t, type SupportedLocale } from "./locale.js";

export type ResearchStageId =
  | "fetch"
  | "products"
  | "audience"
  | "presentation"
  | "questions";

export type ResearchStageStatus = "pending" | "running" | "done" | "failed";

export interface ResearchStage {
  readonly id: ResearchStageId;
  label: string;
  status: ResearchStageStatus;
  startedAt?: number;
  completedAt?: number;
  /** Real fact discovered during this stage, shown progressively. */
  finding?: string;
}

export interface ResearchProgress {
  stages: ResearchStage[];
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const STAGE_ORDER: readonly ResearchStageId[] = [
  "fetch",
  "products",
  "audience",
  "presentation",
  "questions",
];

function stageLabel(id: ResearchStageId, locale: SupportedLocale): string {
  switch (id) {
    case "fetch":
      return t(locale, "Revisando la web", "Reviewing the website");
    case "products":
      return t(locale, "Identificando qué vendes", "Identifying what you sell");
    case "audience":
      return t(locale, "Entendiendo a quién te diriges", "Understanding who you serve");
    case "presentation":
      return t(locale, "Analizando cómo te presentas", "Analysing how you present yourself");
    case "questions":
      return t(
        locale,
        "Preparando lo que necesitamos preguntarte",
        "Preparing what we need to ask you",
      );
  }
}

/** Labels for the no-website path (we read the founder's description). */
function descriptionStageLabel(
  id: ResearchStageId,
  locale: SupportedLocale,
): string {
  if (id === "fetch") {
    return t(locale, "Leyendo lo que nos has contado", "Reading what you told us");
  }
  return stageLabel(id, locale);
}

export function createResearchProgress(
  locale: SupportedLocale,
  mode: "website" | "description",
  now: number = Date.now(),
): ResearchProgress {
  return {
    status: "running",
    startedAt: now,
    stages: STAGE_ORDER.map((id) => ({
      id,
      label:
        mode === "description"
          ? descriptionStageLabel(id, locale)
          : stageLabel(id, locale),
      status: "pending" as ResearchStageStatus,
    })),
  };
}

export function startStage(
  progress: ResearchProgress,
  id: ResearchStageId,
  now: number = Date.now(),
): void {
  const stage = progress.stages.find((s) => s.id === id);
  if (!stage) return;
  stage.status = "running";
  stage.startedAt = now;
}

export function completeStage(
  progress: ResearchProgress,
  id: ResearchStageId,
  finding?: string,
  now: number = Date.now(),
): void {
  const stage = progress.stages.find((s) => s.id === id);
  if (!stage) return;
  stage.status = "done";
  stage.completedAt = now;
  if (finding && finding.trim().length > 0) {
    stage.finding = finding.trim();
  }
  recordDuration(id, (stage.completedAt ?? now) - (stage.startedAt ?? now));
}

export function failProgress(
  progress: ResearchProgress,
  message: string,
  now: number = Date.now(),
): void {
  progress.status = "failed";
  progress.error = message;
  progress.completedAt = now;
  for (const stage of progress.stages) {
    if (stage.status === "running") {
      stage.status = "failed";
      stage.completedAt = now;
    }
  }
}

export function completeProgress(
  progress: ResearchProgress,
  now: number = Date.now(),
): void {
  progress.status = "completed";
  progress.completedAt = now;
  for (const stage of progress.stages) {
    if (stage.status !== "done" && stage.status !== "failed") {
      stage.status = "done";
      stage.completedAt = now;
    }
  }
}

/**
 * Measured historical durations per stage (process lifetime). Used to give an
 * honest estimate. With no history we return `null` and the UI says nothing
 * about time instead of inventing seconds.
 */
const history = new Map<ResearchStageId, number[]>();

function recordDuration(id: ResearchStageId, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const list = history.get(id) ?? [];
  list.push(ms);
  history.set(id, list.slice(-20));
}

export function estimatedTotalMs(): number | null {
  let total = 0;
  for (const id of STAGE_ORDER) {
    const samples = history.get(id);
    if (!samples || samples.length === 0) {
      return null;
    }
    total += samples.reduce((sum, value) => sum + value, 0) / samples.length;
  }
  return Math.round(total);
}

/** Only exposed for deterministic tests. */
export function resetProgressHistory(): void {
  history.clear();
}
