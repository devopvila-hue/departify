/**
 * Sprint 67 P0.8 — Founder Run Store
 *
 * Durable execution model for Founder Development Mode.
 * Decouples OpenClaw execution from HTTP request lifecycle.
 *
 * Architecture:
 *   POST founder message → create FounderRun → return runId
 *   server executes OpenClaw independently
 *   persist events/results
 *   portal subscribes/polls/streams FounderRun
 *   final result persisted
 *
 * The browser connection MUST NOT own the OpenClaw execution.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ─── Types ───────────────────────────────────────────────────────────

export type FounderRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface FounderRun {
  id: string;
  organizationId: string;
  userId: string;
  sessionKey: string;
  openclawSessionId?: string;

  status: FounderRunStatus;
  input: string;

  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastActivityAt: number;

  toolCallCount: number;
  currentStep?: string;

  finalText?: string;
  errorCode?: string;
  errorMessage?: string;

  metadata: Record<string, unknown>;
}

export interface FounderRunEvent {
  id: number;
  runId: string;
  eventType: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export type FounderRunEventType =
  | "run.created"
  | "run.started"
  | "run.queued"
  | "assistant.delta"
  | "tool.started"
  | "tool.completed"
  | "tool.error"
  | "assistant.final"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export interface FounderRunStoreEvents {
  "run:updated": (run: FounderRun) => void;
  "run:event": (runId: string, event: FounderRunEvent) => void;
}

// ─── Store ───────────────────────────────────────────────────────────

/**
 * In-memory FounderRun store with event emitter for SSE streaming.
 *
 * Persistence strategy:
 * - Phase 1 (current): In-memory. Survives within a single process.
 * - Phase 2 (future): Add Supabase persistence via founder_runs table.
 *   The interface is designed to be storage-agnostic.
 *
 * Concurrency:
 * - One active run per sessionKey (enforced by unique index on status)
 * - Additional messages queue behind the active run
 */
export class FounderRunStore extends EventEmitter {
  private runs = new Map<string, FounderRun>();
  private events = new Map<string, FounderRunEvent[]>();
  private eventSeq = 0;

  // ── Queries ──────────────────────────────────────────────────────

  get(runId: string): FounderRun | undefined {
    return this.runs.get(runId);
  }

  getActiveRun(sessionKey: string): FounderRun | undefined {
    for (const run of this.runs.values()) {
      if (
        run.sessionKey === sessionKey &&
        (run.status === "queued" || run.status === "running")
      ) {
        return run;
      }
    }
    return undefined;
  }

  listByOrg(organizationId: string, limit = 20): FounderRun[] {
    return [...this.runs.values()]
      .filter((r) => r.organizationId === organizationId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  getEvents(runId: string, afterSeq?: number): FounderRunEvent[] {
    const events = this.events.get(runId) ?? [];
    if (afterSeq !== undefined) {
      return events.filter((e) => e.id > afterSeq);
    }
    return events;
  }

  // ── Commands ─────────────────────────────────────────────────────

  create(params: {
    organizationId: string;
    userId: string;
    sessionKey: string;
    input: string;
    metadata?: Record<string, unknown>;
  }): FounderRun {
    // Cancel any queued run for the same session first
    const existing = this.getActiveRun(params.sessionKey);
    if (existing && existing.status === "queued") {
      this.cancel(existing.id, "superseded by new message");
    }

    const now = Date.now();
    const run: FounderRun = {
      id: randomUUID(),
      organizationId: params.organizationId,
      userId: params.userId,
      sessionKey: params.sessionKey,
      status: "queued",
      input: params.input,
      createdAt: now,
      lastActivityAt: now,
      toolCallCount: 0,
      metadata: params.metadata ?? {},
    };

    this.runs.set(run.id, run);
    this.events.set(run.id, []);
    this.appendEvent(run.id, "run.created", { input: params.input });
    this.emit("run:updated", run);
    return run;
  }

  markRunning(runId: string, openclawSessionId?: string): void {
    const run = this.mustGet(runId);
    const now = Date.now();
    run.status = "running";
    run.startedAt = now;
    run.lastActivityAt = now;
    if (openclawSessionId) run.openclawSessionId = openclawSessionId;
    this.appendEvent(runId, "run.started", {});
    this.emit("run:updated", run);
  }

  updateProgress(
    runId: string,
    step: string,
    toolCallCount?: number,
  ): void {
    const run = this.mustGet(runId);
    run.currentStep = step;
    run.lastActivityAt = Date.now();
    if (toolCallCount !== undefined) run.toolCallCount = toolCallCount;
    this.emit("run:updated", run);
  }

  appendDelta(runId: string, text: string): void {
    this.appendEvent(runId, "assistant.delta", { text });
    const run = this.runs.get(runId);
    if (run) run.lastActivityAt = Date.now();
  }

  appendToolEvent(
    runId: string,
    type: "tool.started" | "tool.completed" | "tool.error",
    data: Record<string, unknown>,
  ): void {
    const run = this.runs.get(runId);
    if (run) {
      run.lastActivityAt = Date.now();
      if (type === "tool.completed" || type === "tool.error") {
        run.toolCallCount++;
      }
    }
    this.appendEvent(runId, type, data);
    this.emit("run:updated", run!);
  }

  markCompleted(runId: string, finalText: string): void {
    const run = this.mustGet(runId);
    const now = Date.now();
    run.status = "completed";
    run.finalText = finalText;
    run.completedAt = now;
    run.lastActivityAt = now;
    this.appendEvent(runId, "assistant.final", {
      text: finalText,
      toolCallCount: run.toolCallCount,
    });
    this.appendEvent(runId, "run.completed", {
      durationMs: now - (run.startedAt ?? run.createdAt),
      toolCallCount: run.toolCallCount,
    });
    this.emit("run:updated", run);
  }

  markFailed(
    runId: string,
    errorCode: string,
    errorMessage: string,
  ): void {
    const run = this.mustGet(runId);
    const now = Date.now();
    run.status = "failed";
    run.errorCode = errorCode;
    run.errorMessage = errorMessage;
    run.completedAt = now;
    run.lastActivityAt = now;
    this.appendEvent(runId, "run.failed", { errorCode, errorMessage });
    this.emit("run:updated", run);
  }

  cancel(runId: string, reason?: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    if (run.status === "completed" || run.status === "failed") return;
    const now = Date.now();
    run.status = "cancelled";
    run.completedAt = now;
    run.lastActivityAt = now;
    run.errorMessage = reason ?? "Cancelled by user";
    this.appendEvent(runId, "run.cancelled", { reason });
    this.emit("run:updated", run);
  }

  // ── Internals ────────────────────────────────────────────────────

  private mustGet(runId: string): FounderRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`FounderRun not found: ${runId}`);
    return run;
  }

  private appendEvent(
    runId: string,
    eventType: FounderRunEventType,
    data: Record<string, unknown>,
  ): void {
    const id = ++this.eventSeq;
    const event: FounderRunEvent = {
      id,
      runId,
      eventType,
      data,
      createdAt: Date.now(),
    };
    const list = this.events.get(runId);
    if (list) list.push(event);
    this.emit("run:event", runId, event);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  /**
   * Remove completed/failed runs older than maxAgeMs.
   * Call periodically to prevent memory leaks.
   */
  cleanup(maxAgeMs = 3600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, run] of this.runs) {
      if (
        (run.status === "completed" ||
          run.status === "failed" ||
          run.status === "cancelled") &&
        (run.completedAt ?? run.createdAt) < cutoff
      ) {
        this.runs.delete(id);
        this.events.delete(id);
      }
    }
  }
}

// Singleton instance
export const founderRunStore = new FounderRunStore();
