import type { IsolationLevel } from "../security/tool-security.js";

/**
 * Sandbox primitive abstractions.
 *
 * Sprint 20 ships the *contract* only. The Runtime uses these abstractions
 * to plan execution and emit events; concrete isolation backends (process
 * jails, Docker, Firecracker, gVisor) plug in via future adapter packages.
 */

export interface SandboxDescriptor {
  readonly id: string;
  readonly isolation: IsolationLevel;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface Sandbox {
  describe(): SandboxDescriptor;
  /**
   * Run a unit of work inside the sandbox. Sprint 20 does not invoke this
   * method; it remains for the future Sprint that wires real isolation.
   */
  run?<T>(work: () => Promise<T>): Promise<T>;
  cancel?(): Promise<void>;
}

export type AbortListener = (reason: string) => void;

/**
 * Lightweight cancellation primitive used by the execution pipeline. The
 * Runtime always pairs a Tool execution with a `ToolAbortController`-like
 * handle so upstream callers can cancel the work cooperatively.
 */
export interface ToolAbortController {
  readonly signal: ToolAbortSignal;
  cancel(reason?: string): void;
}

export interface ToolAbortSignal {
  readonly aborted: boolean;
  readonly reason?: string;
  onAbort(listener: AbortListener): void;
}

/**
 * Default implementation backed by a simple listener list.
 */
export class DefaultToolAbortController implements ToolAbortController {
  private listeners: AbortListener[] = [];
  private aborted = false;
  private cancellationReason: string | undefined;

  readonly signal: ToolAbortSignal = {
    aborted: false,
    onAbort: (listener: AbortListener): void => {
      if (this.aborted) {
        listener(this.cancellationReason ?? "cancelled");
        return;
      }
      this.listeners.push(listener);
    },
  };

  cancel(reason = "cancelled"): void {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.cancellationReason = reason;
    // Replace the signal with a frozen aborted snapshot.
    const listeners = this.listeners;
    this.listeners = [];
    const abortedSignal: ToolAbortSignal = {
      aborted: true,
      ...(reason ? { reason } : {}),
      onAbort: (listener: AbortListener): void => {
        listener(reason);
      },
    };
    (this.signal as unknown as { aborted: boolean; reason?: string }) =
      abortedSignal;
    for (const listener of listeners) {
      listener(reason);
    }
  }

  /** Test-only accessor; not part of the public contract. */
  debugSnapshot(): {
    aborted: boolean;
    reason?: string;
    pendingListeners: number;
  } {
    return {
      aborted: this.aborted,
      ...(this.cancellationReason ? { reason: this.cancellationReason } : {}),
      pendingListeners: this.listeners.length,
    };
  }
}
