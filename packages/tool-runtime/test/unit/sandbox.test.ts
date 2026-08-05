import { DefaultToolAbortController } from "../../src/index.js";

describe("DefaultToolAbortController", () => {
  it("starts in non-aborted state", () => {
    const controller = new DefaultToolAbortController();
    expect(controller.signal.aborted).toBe(false);
    expect(controller.signal.reason).toBeUndefined();
  });

  it("flips to aborted state when cancel is called", () => {
    const controller = new DefaultToolAbortController();
    controller.cancel("manual");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("manual");
  });

  it("invokes onAbort listeners on cancel", () => {
    const controller = new DefaultToolAbortController();
    const calls: string[] = [];
    controller.signal.onAbort((reason) => {
      calls.push(reason);
    });
    controller.cancel("stop");
    expect(calls).toEqual(["stop"]);
  });

  it("invokes listeners registered after cancel immediately", () => {
    const controller = new DefaultToolAbortController();
    controller.cancel("immediate");
    const calls: string[] = [];
    controller.signal.onAbort((reason) => {
      calls.push(reason);
    });
    expect(calls).toEqual(["immediate"]);
  });

  it("ignores duplicate cancel calls", () => {
    const controller = new DefaultToolAbortController();
    const calls: string[] = [];
    controller.signal.onAbort((reason) => {
      calls.push(reason);
    });
    controller.cancel("first");
    controller.cancel("second");
    expect(calls).toEqual(["first"]);
    expect(controller.signal.reason).toBe("first");
  });
});
