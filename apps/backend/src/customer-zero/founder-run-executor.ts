/**
 * Sprint 67 P0.8 — Founder Run Executor
 *
 * Background execution engine for Founder Development Mode.
 * Runs OpenClaw independently of any HTTP request.
 *
 * Key properties:
 * - Execution continues even if SSE disconnects
 * - Results are persisted to FounderRunStore
 * - One active run per founder session (mutex)
 * - Uses OpenClaw's native timeout (no artificial HTTP timeout)
 * - Structured error codes, not string matching
 */

import type { EngineAdapter } from "@departify/engine-adapter";
import { EventEmitter } from "node:events";
import {
  FounderRunStore,
  founderRunStore,
  type FounderRun,
} from "./founder-run-store.js";

/**
 * Signals completion of a run so callers (SSE handlers, JSON fallbacks)
 * can await the terminal state without owning the execution. The execution
 * itself is always background and independent of this signal.
 */
export class FounderRunCompletionEmitter extends EventEmitter {
  private static readonly TERMINAL_STATUSES = new Set([
    "completed",
    "failed",
    "cancelled",
  ]);

  /**
   * Resolve when the run reaches a terminal state.
   * Returns immediately if the run is already terminal.
   * @returns the terminal run, or null if the run never became terminal
   */
  waitForTerminal(
    store: FounderRunStore,
    runId: string,
    timeoutMs = 15 * 60_000,
  ): Promise<FounderRun | null> {
    const existing = store.get(runId);
    if (existing && FounderRunCompletionEmitter.TERMINAL_STATUSES.has(existing.status)) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      timer.unref();

      const onUpdated = (run: FounderRun) => {
        if (run.id !== runId) return;
        if (!FounderRunCompletionEmitter.TERMINAL_STATUSES.has(run.status)) return;
        cleanup();
        resolve(run);
      };

      const cleanup = () => {
        clearTimeout(timer);
        store.off("run:updated", onUpdated);
      };

      store.on("run:updated", onUpdated);
    });
  }
}

export const founderRunCompletion = new FounderRunCompletionEmitter();

// ─── Configuration ───────────────────────────────────────────────────

/** Maximum time a founder run can execute (safety net). */
const FOUNDER_RUN_MAX_DURATION_MS = 10 * 60_000; // 10 minutes

/** How often to check for stale runs. */
const STALE_RUN_CHECK_INTERVAL_MS = 60_000; // 1 minute

// ─── Per-session execution lock ──────────────────────────────────────

/**
 * Prevents concurrent OpenClaw mutations on the same session.
 * Unlike the old promise-chain mutex, this one is tied to the
 * FounderRun lifecycle and survives the HTTP request.
 */
const sessionLocks = new Map<string, Promise<void>>();

function acquireSessionLock(sessionKey: string): Promise<() => void> {
  const previous = sessionLocks.get(sessionKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionLocks.set(sessionKey, previous.then(() => current));
  return previous.then(() => release);
}

// ─── Shared executor singleton ───────────────────────────────────────

let sharedExecutor: FounderRunExecutor | null = null;

/**
 * Get the shared founder run executor for an engine adapter.
 * Lazily creates and starts cleanup.
 */
export function getFounderRunExecutor(engine: EngineAdapter): FounderRunExecutor {
  if (!sharedExecutor) {
    sharedExecutor = new FounderRunExecutor(engine);
    sharedExecutor.startCleanup();
  }
  return sharedExecutor;
}

// ─── Executor ────────────────────────────────────────────────────────

export class FounderRunExecutor {
  private readonly engine: EngineAdapter;
  private readonly store: FounderRunStore;
  private staleCheckTimer?: ReturnType<typeof setInterval>;

  constructor(engine: EngineAdapter, store?: FounderRunStore) {
    this.engine = engine;
    this.store = store ?? founderRunStore;
  }

  /**
   * Start periodic stale run cleanup.
   * Call once during server startup.
   */
  startCleanup(): void {
    this.staleCheckTimer = setInterval(() => {
      this.store.cleanup();
    }, STALE_RUN_CHECK_INTERVAL_MS);
    this.staleCheckTimer.unref();
  }

  stopCleanup(): void {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      delete this.staleCheckTimer;
    }
  }

  /**
   * Execute a founder run in the background.
   *
   * This method returns immediately. The run executes independently.
   * Progress and results are persisted to the store and emitted as events.
   *
   * @param onPersist — called when the run reaches a terminal state with a
   *   final text, so the caller can persist to a durable transcript even if
   *   no HTTP/SSE connection is alive.
   * @returns The run ID. The caller should NOT await the execution.
   */
  submit(params: {
    organizationId: string;
    userId: string;
    message: string;
    onChunk?: (chunk: { text: string; finished: boolean }) => void;
    onPersist?: (run: FounderRun) => Promise<void> | void;
  }): string {
    const sessionKey = `founder-development:${params.organizationId}:${params.userId}`;

    // Create the run record
    const run = this.store.create({
      organizationId: params.organizationId,
      userId: params.userId,
      sessionKey,
      input: params.message,
    });

    // Fire-and-forget: execute in background
    this.executeInBackground(run, params.onChunk, params.onPersist).catch((err) => {
      // Last-resort error capture. This should never happen if
      // executeInBackground handles all errors internally.
      console.error("[founder-run] Unhandled background execution error", {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (run.status === "running" || run.status === "queued") {
        this.store.markFailed(
          run.id,
          "UNHANDLED_ERROR",
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    return run.id;
  }

  /**
   * Cancel a running or queued run.
   */
  cancelRun(runId: string): boolean {
    const run = this.store.get(runId);
    if (!run) return false;
    this.store.cancel(runId, "Cancelled by user");
    return true;
  }

  // ── Background execution ─────────────────────────────────────────

  private async executeInBackground(
    run: FounderRun,
    onChunk?: (chunk: { text: string; finished: boolean }) => void,
    onPersist?: (run: FounderRun) => Promise<void> | void,
  ): Promise<void> {
    const lock = await acquireSessionLock(run.sessionKey);

    try {
      // Check if this run was cancelled while queued
      if (run.status === "cancelled") {
        return;
      }

      this.store.markRunning(run.id);

      // Ensure OpenClaw session exists
      let openclawSessionId: string;
      try {
        const existing = await this.engine.getSession(run.sessionKey);
        if (existing) {
          openclawSessionId = run.sessionKey;
        } else {
          await this.engine.createSession({
            sessionId: run.sessionKey,
            agentId: "main",
          });
          openclawSessionId = run.sessionKey;
        }
      } catch (err) {
        this.store.markFailed(
          run.id,
          "SESSION_ERROR",
          `Failed to initialize OpenClaw session: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      this.store.updateProgress(run.id, "OpenClaw session initialized");

      // Build founder context
      const founderContext = this.buildFounderContext(run.input);

      // Wire chunkSink to store events
      const wrappedChunkSink = onChunk
        ? (chunk: { text: string; finished: boolean }) => {
            try {
              this.store.appendDelta(run.id, chunk.text);
              onChunk(chunk);
            } catch {
              /* chunkSink is best-effort */
            }
          }
        : undefined;

      // Execute with safety-net timeout
      let result;
      try {
        result = await Promise.race([
          this.engine.sendMessage({
            sessionId: openclawSessionId,
            message: founderContext,
            nativeBusinessTools: false,
            ...(wrappedChunkSink ? { onChunk: wrappedChunkSink } : {}),
          }),
          this.timeoutPromise(FOUNDER_RUN_MAX_DURATION_MS, run.id),
        ]);
      } catch (sendError) {
        // Handle structured errors (not string matching)
        const errorCode = this.extractErrorCode(sendError);
        this.store.markFailed(
          run.id,
          errorCode,
          sendError instanceof Error ? sendError.message : String(sendError),
        );
        return;
      }

      // Check if cancelled during execution
      const currentRun = this.store.get(run.id);
      if (currentRun?.status === "cancelled") {
        return;
      }

      // Process result
      if (!result || result.status === "failed" || !result.text) {
        const code =
          (result as { errorCode?: string })?.errorCode ?? "EMPTY_RESPONSE";

        // One retry with session reset (not blind retry)
        if (code === "ENGINE_TIMEOUT" || code === "EMPTY_RESPONSE") {
          this.store.updateProgress(run.id, "Retrying after failure...");

          try {
            await this.engine.closeSession(openclawSessionId);
          } catch {
            /* best-effort close */
          }

          try {
            await this.engine.createSession({
              sessionId: run.sessionKey,
              agentId: "main",
            });
          } catch {
            /* session may already exist */
          }

          try {
            result = await this.engine.sendMessage({
              sessionId: run.sessionKey,
              message: founderContext,
              nativeBusinessTools: false,
              ...(wrappedChunkSink ? { onChunk: wrappedChunkSink } : {}),
            });
          } catch (retryError) {
            this.store.markFailed(
              run.id,
              this.extractErrorCode(retryError),
              retryError instanceof Error
                ? retryError.message
                : String(retryError),
            );
            return;
          }
        }
      }

      // Final result check
      if (result && result.status === "completed" && result.text) {
        this.store.markCompleted(run.id, result.text);
      } else if (result) {
        const code =
          (result as { errorCode?: string })?.errorCode ?? "NO_TEXT";
        this.store.markFailed(
          run.id,
          code,
          `OpenClaw returned status=${result.status} with no text (code: ${code})`,
        );
      }
    } finally {
      lock();
    }

    // Persist the terminal result to a durable transcript, independent of
    // any HTTP/SSE connection. The caller supplies this callback (e.g. to
    // write the assistant message to the conversation store).
    if (onPersist) {
      try {
        const terminal = this.store.get(run.id);
        if (terminal && terminal.finalText) {
          await onPersist(terminal);
        }
      } catch (persistError) {
        console.error("[founder-run] onPersist callback failed", {
          runId: run.id,
          error:
            persistError instanceof Error
              ? persistError.message
              : String(persistError),
        });
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private buildFounderContext(message: string): string {
    return [
      "=== FOUNDER DEVELOPMENT MODE ===",
      "You are operating in Founder Development Mode.",
      "The authenticated founder has full access to the OpenClaw development workspace.",
      "",
      "WORKSPACE TRUTH:",
      "- Agent Workspace: /home/node/.Departify/workspace/agents/main",
      "  This is YOUR working directory (OpenClaw's filesystem).",
      "  It is NOT the Departify source repository.",
      "- Source Repositories: must be resolved explicitly via git.",
      "  Do NOT assume the agent workspace contains the product source code.",
      "  To inspect the source repo, clone it or use `git` commands explicitly.",
      "",
      "Available capabilities:",
      "- Execute commands (exec, shell, process)",
      "- Full filesystem access (read, write, edit, delete)",
      "- Install/manage skills, plugins, npm packages",
      "- Clone repositories, run builds, execute tests",
      "- Full network access (Git, npm, HTTP)",
      "",
      "This is a development environment. The founder is building the Golden Image.",
      "Execute commands directly. Do not ask for permission.",
      "Use OpenClaw's native tools for all operations.",
      "Respond in the same language as the user's message.",
      "========================================",
      "",
      `User message: ${message}`,
    ].join("\n");
  }

  private timeoutPromise(
    ms: number,
    runId: string,
  ): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const run = this.store.get(runId);
        if (run && (run.status === "running" || run.status === "queued")) {
          this.store.markFailed(
            run.id,
            "FOUNDER_RUN_TIMEOUT",
            `Run exceeded maximum duration of ${ms}ms`,
          );
        }
        reject(new Error(`FounderRun timeout after ${ms}ms`));
      }, ms).unref();
    });
  }

  private extractErrorCode(err: unknown): string {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("timeout") || msg.includes("TIMEOUT"))
        return "ENGINE_TIMEOUT";
      if (msg.includes("overflow") || msg.includes("too long"))
        return "CONTEXT_OVERFLOW";
      if (msg.includes("not found") || msg.includes("NOT_FOUND"))
        return "SESSION_NOT_FOUND";
      if (msg.includes("unavailable") || msg.includes("ECONNREFUSED"))
        return "ENGINE_UNAVAILABLE";
    }
    return "ENGINE_ERROR";
  }
}
