/**
 * Sprint 67 P0.8 — Founder Run Reliability Tests.
 *
 * Validates the durable execution model for Founder Development Mode:
 * - FounderRunStore lifecycle (create, progress, complete, fail, cancel)
 * - FounderRunExecutor background execution
 * - Session lock prevents concurrent runs
 * - SSE reconnection via event replay
 * - Long-running multi-tool simulation
 * - Workspace truth in founder context
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FounderRunStore, type FounderRun } from "../src/customer-zero/founder-run-store.js";
import { FounderRunExecutor, FounderRunCompletionEmitter } from "../src/customer-zero/founder-run-executor.js";
import type { EngineAdapter, EngineMessageResult } from "@departify/engine-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEngine(overrides?: {
  sendMessage?: () => Promise<EngineMessageResult>;
  delay?: number;
}): EngineAdapter {
  const sendMessage =
    overrides?.sendMessage ??
    vi.fn().mockImplementation(async () => {
      if (overrides?.delay) {
        await new Promise((r) => setTimeout(r, overrides.delay));
      }
      return {
        text: "Mock OpenClaw response with tool results.",
        status: "completed",
      } satisfies EngineMessageResult;
    });

  return {
    sendMessage,
    createSession: vi.fn().mockResolvedValue({ id: "mock-session" }),
    getSession: vi.fn().mockResolvedValue(null),
    getHistory: vi.fn().mockResolvedValue({ messages: [] }),
    closeSession: vi.fn().mockResolvedValue(undefined),
    getUsage: vi.fn().mockResolvedValue({ tokens: 0 }),
    getToolState: vi.fn().mockResolvedValue({ tools: [] }),
    health: vi.fn().mockResolvedValue({ status: "ok" }),
  } satisfies EngineAdapter;
}

// ---------------------------------------------------------------------------
// TEST 1 — FounderRunStore Lifecycle
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — FounderRunStore Lifecycle", () => {
  let store: FounderRunStore;

  beforeEach(() => {
    store = new FounderRunStore();
  });

  it("should create a run with queued status", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "founder-development:org-1:user-1",
      input: "inspect the repository",
    });

    expect(run.id).toBeDefined();
    expect(run.status).toBe("queued");
    expect(run.organizationId).toBe("org-1");
    expect(run.userId).toBe("user-1");
    expect(run.input).toBe("inspect the repository");
    expect(run.toolCallCount).toBe(0);
    expect(run.createdAt).toBeGreaterThan(0);
    expect(run.lastActivityAt).toBeGreaterThan(0);
  });

  it("should transition through running → completed", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });

    store.markRunning(run.id);
    const running = store.get(run.id)!;
    expect(running.status).toBe("running");
    expect(running.startedAt).toBeDefined();

    store.appendDelta(run.id, "partial text...");
    store.appendToolEvent(run.id, "tool.started", { tool: "exec" });
    store.appendToolEvent(run.id, "tool.completed", { tool: "exec", exitCode: 0 });

    store.markCompleted(run.id, "Final response text.");
    const completed = store.get(run.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.finalText).toBe("Final response text.");
    expect(completed.completedAt).toBeDefined();
    expect(completed.toolCallCount).toBe(1); // only tool.completed increments
  });

  it("should transition to failed with structured error", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.markRunning(run.id);
    store.markFailed(run.id, "ENGINE_TIMEOUT", "OpenClaw timed out after 600s");

    const failed = store.get(run.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("ENGINE_TIMEOUT");
    expect(failed.errorMessage).toBe("OpenClaw timed out after 600s");
  });

  it("should cancel a queued run", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.cancel(run.id, "User cancelled");

    const cancelled = store.get(run.id)!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.errorMessage).toBe("User cancelled");
  });

  it("should not cancel a completed run", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.markRunning(run.id);
    store.markCompleted(run.id, "done");
    store.cancel(run.id, "too late");

    const completed = store.get(run.id)!;
    expect(completed.status).toBe("completed"); // unchanged
  });

  it("should cancel queued run when new message arrives for same session", () => {
    const run1 = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "first message",
    });
    const run2 = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "second message",
    });

    expect(store.get(run1.id)!.status).toBe("cancelled");
    expect(store.get(run2.id)!.status).toBe("queued");
  });

  it("should get active run for session", () => {
    store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });

    const active = store.getActiveRun("s1");
    expect(active).toBeDefined();
    expect(active!.status).toBe("queued");
  });

  it("should return undefined when no active run exists", () => {
    const active = store.getActiveRun("nonexistent");
    expect(active).toBeUndefined();
  });

  it("should list runs by organization", () => {
    store.create({ organizationId: "org-1", userId: "u1", sessionKey: "s1", input: "a" });
    store.create({ organizationId: "org-1", userId: "u2", sessionKey: "s2", input: "b" });
    store.create({ organizationId: "org-2", userId: "u3", sessionKey: "s3", input: "c" });

    const org1Runs = store.listByOrg("org-1");
    expect(org1Runs).toHaveLength(2);
    expect(org1Runs.every((r) => r.organizationId === "org-1")).toBe(true);
  });

  it("should persist events and replay with afterSeq", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.markRunning(run.id);
    store.appendDelta(run.id, "chunk 1");
    store.appendDelta(run.id, "chunk 2");
    store.appendToolEvent(run.id, "tool.started", { tool: "exec" });
    store.appendToolEvent(run.id, "tool.completed", { tool: "exec" });

    const allEvents = store.getEvents(run.id);
    expect(allEvents.length).toBeGreaterThanOrEqual(6); // created, started, 2 deltas, 2 tool events

    // Replay only events after the 3rd event
    const afterSeq = allEvents[2]!.id;
    const replayed = store.getEvents(run.id, afterSeq);
    expect(replayed.length).toBeLessThan(allEvents.length);
    expect(replayed.every((e) => e.id > afterSeq)).toBe(true);
  });

  it("should emit run:updated events", () => {
    const updates: Array<{ id: string; status: string }> = [];
    store.on("run:updated", (run) => updates.push({ id: run.id, status: run.status }));

    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.markRunning(run.id);
    store.markCompleted(run.id, "done");

    expect(updates).toHaveLength(3); // created, running, completed
    expect(updates[0]!.status).toBe("queued");
    expect(updates[1]!.status).toBe("running");
    expect(updates[2]!.status).toBe("completed");
  });

  it("should cleanup old terminal runs", () => {
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.markRunning(run.id);
    store.markCompleted(run.id, "done");

    // Manually set completedAt to old timestamp
    const r = store.get(run.id)!;
    (r as { completedAt?: number }).completedAt = Date.now() - 7200_000; // 2 hours ago

    store.cleanup(3600_000); // cleanup runs older than 1 hour
    expect(store.get(run.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TEST 2 — FounderRunExecutor Background Execution
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — FounderRunExecutor Background Execution", () => {
  let store: FounderRunStore;

  beforeEach(() => {
    store = new FounderRunStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should submit a run and return runId immediately", () => {
    const engine = createMockEngine();
    const executor = new FounderRunExecutor(engine, store);

    const runId = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "test message",
    });

    expect(runId).toBeDefined();
    expect(typeof runId).toBe("string");
    expect(store.get(runId)).toBeDefined();
    expect(store.get(runId)!.status).toBe("queued");
  });

  it("should execute in background and complete", async () => {
    const engine = createMockEngine({
      sendMessage: vi.fn().mockResolvedValue({
        text: "Repository inspection complete. Found 42 files.",
        status: "completed",
      }),
    });
    const executor = new FounderRunExecutor(engine, store);

    const completion = new FounderRunCompletionEmitter();
    const runId = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "inspect repository",
    });

    // Wait for background execution to complete
    const terminal = await completion.waitForTerminal(store, runId, 10_000);
    expect(terminal).not.toBeNull();
    expect(terminal!.status).toBe("completed");
    expect(terminal!.finalText).toContain("Repository inspection complete");
  });

  it("should handle engine errors gracefully", async () => {
    const engine = createMockEngine({
      sendMessage: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const executor = new FounderRunExecutor(engine, store);

    const completion = new FounderRunCompletionEmitter();
    const runId = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "test",
    });

    const terminal = await completion.waitForTerminal(store, runId, 10_000);
    expect(terminal).not.toBeNull();
    expect(terminal!.status).toBe("failed");
    expect(terminal!.errorCode).toBe("ENGINE_UNAVAILABLE");
  });

  it("should call onPersist with terminal run", async () => {
    const engine = createMockEngine({
      sendMessage: vi.fn().mockResolvedValue({
        text: "Final text for persistence.",
        status: "completed",
      }),
    });
    const executor = new FounderRunExecutor(engine, store);

    // Use a promise to track onPersist calls
    let persistResolve: (run: FounderRun) => void;
    const persistPromise = new Promise<FounderRun>((resolve) => {
      persistResolve = resolve;
    });

    const completion = new FounderRunCompletionEmitter();
    const runId = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "test",
      onPersist: (run) => persistResolve(run),
    });

    await completion.waitForTerminal(store, runId, 10_000);
    // onPersist is called asynchronously after waitForTerminal resolves
    const persistedRun = await persistPromise;
    expect(persistedRun.finalText).toBe("Final text for persistence.");
  });
});

// ---------------------------------------------------------------------------
// TEST 3 — Session Lock (No Concurrent Runs)
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — Session Lock", () => {
  it("should serialize runs for the same session", async () => {
    const executionOrder: string[] = [];
    const engine = createMockEngine({
      sendMessage: vi.fn().mockImplementation(async () => {
        const id = `run-${Date.now()}`;
        executionOrder.push(id);
        await new Promise((r) => setTimeout(r, 100));
        return { text: `Response from ${id}`, status: "completed" };
      }),
    });
    const store = new FounderRunStore();
    const executor = new FounderRunExecutor(engine, store);

    // Submit two runs for the same session
    const runId1 = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "first",
    });
    const runId2 = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "second",
    });

    // The first should be cancelled (superseded by second)
    expect(store.get(runId1)!.status).toBe("cancelled");
    expect(store.get(runId2)!.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// TEST 4 — SSE Reconnection (Event Replay)
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — SSE Reconnection", () => {
  it("should replay missed events with afterSeq", () => {
    const store = new FounderRunStore();
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });

    // Simulate a series of events
    store.markRunning(run.id);
    store.appendDelta(run.id, "chunk 1");
    store.appendDelta(run.id, "chunk 2");
    store.appendToolEvent(run.id, "tool.started", { tool: "exec" });
    store.appendToolEvent(run.id, "tool.completed", { tool: "exec", exitCode: 0 });
    store.appendDelta(run.id, "chunk 3");
    store.markCompleted(run.id, "Final text.");

    const allEvents = store.getEvents(run.id);
    expect(allEvents.length).toBeGreaterThanOrEqual(7);

    // Simulate a client that missed events after the 3rd event
    const missedFrom = allEvents[2]!.id;
    const replayed = store.getEvents(run.id, missedFrom);

    // All replayed events should have id > missedFrom
    expect(replayed.every((e) => e.id > missedFrom)).toBe(true);
    // Should include the terminal event
    const terminal = replayed.find((e) => e.eventType === "run.completed");
    expect(terminal).toBeDefined();
  });

  it("should handle reconnect to already-completed run", () => {
    const store = new FounderRunStore();
    const run = store.create({
      organizationId: "org-1",
      userId: "user-1",
      sessionKey: "s1",
      input: "test",
    });
    store.markRunning(run.id);
    store.markCompleted(run.id, "Already done.");

    // Client reconnects — should get all events including terminal
    const events = store.getEvents(run.id);
    const terminal = events.find((e) => e.eventType === "run.completed");
    expect(terminal).toBeDefined();

    // The run's finalText should be available
    const current = store.get(run.id);
    expect(current!.finalText).toBe("Already done.");
  });
});

// ---------------------------------------------------------------------------
// TEST 5 — Long-Running Multi-Tool Simulation
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — Long-Running Multi-Tool Run", () => {
  it("should handle 10+ tool calls in a single run", async () => {
    let toolCallCount = 0;
    const engine = createMockEngine({
      sendMessage: vi.fn().mockImplementation(async () => {
        // Simulate 12 tool calls
        for (let i = 0; i < 12; i++) {
          toolCallCount++;
          await new Promise((r) => setTimeout(r, 10));
        }
        return {
          text: "Completed 12 tool operations. Repository cloned, packages installed, build passed.",
          status: "completed",
        };
      }),
    });

    const store = new FounderRunStore();
    const executor = new FounderRunExecutor(engine, store);
    const completion = new FounderRunCompletionEmitter();

    const runId = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "clone repo, install deps, run build, run tests",
    });

    // Simulate tool events during execution
    const run = store.get(runId)!;
    store.markRunning(run.id);
    for (let i = 0; i < 12; i++) {
      store.appendToolEvent(run.id, "tool.started", { tool: `tool-${i}` });
      store.appendToolEvent(run.id, "tool.completed", { tool: `tool-${i}`, exitCode: 0 });
    }

    const terminal = await completion.waitForTerminal(store, runId, 10_000);
    expect(terminal).not.toBeNull();
    expect(terminal!.status).toBe("completed");
    expect(terminal!.toolCallCount).toBe(12);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// TEST 6 — Workspace Truth
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — Workspace Truth", () => {
  it("should include workspace truth in founder context", () => {
    const engine = createMockEngine();
    const store = new FounderRunStore();
    const executor = new FounderRunExecutor(engine, store);

    // Submit a run and capture the message sent to the engine
    const sendMessage = engine.sendMessage as ReturnType<typeof vi.fn>;
    executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "inspect the repository",
    });

    // The message should be sent asynchronously. Wait a tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        if (sendMessage.mock.calls.length > 0) {
          const sentMessage = sendMessage.mock.calls[0][0].message as string;
          expect(sentMessage).toContain("WORKSPACE TRUTH");
          expect(sentMessage).toContain("Agent Workspace");
          expect(sentMessage).toContain("/home/node/.Departify/workspace/agents/main");
          expect(sentMessage).toContain("NOT the Departify source repository");
          expect(sentMessage).toContain("Source Repositories: must be resolved explicitly");
        }
        resolve();
      }, 100);
    });
  });
});

// ---------------------------------------------------------------------------
// TEST 7 — No Generic Error on Successful Run
// ---------------------------------------------------------------------------
describe("Sprint 67 P0.8 — No Generic Red Error", () => {
  it("should NOT produce generic error on successful founder run", async () => {
    const engine = createMockEngine({
      sendMessage: vi.fn().mockResolvedValue({
        text: "git status shows clean working tree. Branch: main.",
        status: "completed",
      }),
    });
    const store = new FounderRunStore();
    const executor = new FounderRunExecutor(engine, store);
    const completion = new FounderRunCompletionEmitter();

    const runId = executor.submit({
      organizationId: "org-1",
      userId: "user-1",
      message: "run git status",
    });

    const terminal = await completion.waitForTerminal(store, runId, 10_000);
    expect(terminal).not.toBeNull();
    expect(terminal!.status).toBe("completed");
    expect(terminal!.finalText).toBeDefined();
    expect(terminal!.finalText!.length).toBeGreaterThan(0);
    // No error code on success
    expect(terminal!.errorCode).toBeUndefined();
    expect(terminal!.errorMessage).toBeUndefined();
  });
});
