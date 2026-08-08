/**
 * Sprint 62 — capability engine integration with the Customer Zero session.
 *
 * Proves the acceptance contract end-to-end through the REAL composed session:
 *   A. Mautic connected → capability READY.
 *   C. Mautic disconnected → capability unavailable.
 *   D. Operational Context contains connected-system state.
 *   E. Memory cannot override connection truth.
 */
import { describe, expect, it } from "vitest";

import { getOrCreateCustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";
import {
  buildOperationalSourcePort,
  buildSessionOperationalContext,
} from "../src/customer-zero/operational-context.js";
import { completeConnection, buildConnectionState, TOOL_CATALOG } from "../src/customer-zero/connections.js";

function mauticTool() {
  return TOOL_CATALOG.find((tool) => tool.id === "mautic")!;
}

describe("Sprint 62 — capability engine integration", () => {
  it("A. Mautic connected → capability READY through the real session", () => {
    const session = getOrCreateCustomerZeroSession("org_s62_ready");
    const connection = buildConnectionState(mauticTool(), "es");
    session.state.connections.set("mautic", completeConnection(connection));

    // The canonical certification path (the connect flow certifies, and the
    // operational context re-derives from the real connection + tool runtime).
    buildSessionOperationalContext(session);

    const source = buildOperationalSourcePort(session);
    const derived = session.capabilities.derive(source);
    const mautic = derived.find((entry) => entry.capability.id === "mautic");
    expect(mautic?.status).toBe("ready");
    expect(session.capabilities.isReady("mautic", source)).toBe(true);
  });

  it("C. Mautic disconnected → capability unavailable", () => {
    const session = getOrCreateCustomerZeroSession("org_s62_unavailable");
    const source = buildOperationalSourcePort(session);
    const derived = session.capabilities.derive(source);
    const mautic = derived.find((entry) => entry.capability.id === "mautic");
    expect(mautic?.status).toBe("unavailable");
    expect(session.capabilities.isReady("mautic", source)).toBe(false);
  });

  it("D. Operational Context contains connected-system state", () => {
    const session = getOrCreateCustomerZeroSession("org_s62_ctx");
    const connection = buildConnectionState(mauticTool(), "es");
    session.state.connections.set("mautic", completeConnection(connection));

    const ctx = buildSessionOperationalContext(session);
    expect(ctx.connectedSystems.find((system) => system.toolId === "mautic")?.status).toBe("connected");
    expect(ctx.capabilities.find((capability) => capability.id === "mautic")?.status).toBe("ready");
    expect(ctx.departments.find((d) => d.id === "marketing")?.head).toBeTruthy();
    expect(ctx.promptView).toContain("SISTEMAS CONECTADOS");
    expect(ctx.promptView).toContain("Mautic");
  });

  it("E. Memory cannot override connection truth", () => {
    const session = getOrCreateCustomerZeroSession("org_s62_memory");
    // The session has NO mautic connection, but memory could claim it exists.
    const source = buildOperationalSourcePort(session);
    expect(session.capabilities.isReady("mautic", source)).toBe(false);
    const derived = session.capabilities.derive(source);
    expect(derived.find((entry) => entry.capability.id === "mautic")?.status).toBe("unavailable");
  });
});
