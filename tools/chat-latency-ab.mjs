#!/usr/bin/env node

/**
 * Diagnostic A/B runner for the CEO chat.
 *
 * It deliberately accepts credentials only through the environment, never
 * prints them, and prints no prompt/response text. A direct OpenClaw turn is
 * compared with the Departify HTTP turn using the same prompt and model.
 *
 * Required:
 *   DEPARTIFY_AB_API_TOKEN
 *   DEPARTIFY_AB_ORGANIZATION_ID
 *   OPENCLAW_GATEWAY_URL
 *   OPENCLAW_GATEWAY_TOKEN (or OPENCLAW_DEVICE_KEY_PATH / PEM)
 *
 * The Departify backend must already be configured with the same
 * OPENCLAW_MODEL as the OPENCLAW_MODEL supplied to this runner. The HTTP
 * endpoint intentionally does not accept a model override.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const prompt = process.env.DEPARTIFY_AB_PROMPT?.trim();
const apiToken = process.env.DEPARTIFY_AB_API_TOKEN?.trim();
const organizationId = process.env.DEPARTIFY_AB_ORGANIZATION_ID?.trim();
const apiBaseUrl = (
  process.env.DEPARTIFY_AB_API_URL ?? "https://api.departify.app"
).replace(/\/$/, "");
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
const deviceKeyPath = process.env.OPENCLAW_DEVICE_KEY_PATH?.trim();
const deviceKeyPem = process.env.OPENCLAW_DEVICE_KEY_PEM;
const model = process.env.OPENCLAW_MODEL?.trim();
const requestTimeoutMs = Number(
  process.env.OPENCLAW_REQUEST_TIMEOUT_MS ?? 120_000,
);
const connectTimeoutMs = Number(
  process.env.OPENCLAW_CONNECT_TIMEOUT_MS ?? 15_000,
);
const retryLimit = Number(process.env.OPENCLAW_RETRY_LIMIT ?? 2);
const maxRetryDelayMs = Number(
  process.env.OPENCLAW_MAX_RETRY_DELAY_MS ?? 8_000,
);
const httpTimeoutMs = Number(
  process.env.DEPARTIFY_AB_HTTP_TIMEOUT_MS ?? 180_000,
);

function usage(message) {
  console.error(message);
  console.error(
    "Usage: DEPARTIFY_AB_PROMPT='...' DEPARTIFY_AB_API_TOKEN='...' DEPARTIFY_AB_ORGANIZATION_ID='...' OPENCLAW_GATEWAY_URL='...' OPENCLAW_GATEWAY_TOKEN='...' OPENCLAW_MODEL='provider/model' pnpm chat:latency-ab",
  );
  process.exitCode = 2;
}

if (process.argv.includes("--help")) {
  console.log(
    "See tools/chat-latency-ab.mjs for required environment variables.",
  );
  process.exit(0);
}

const { createEngineAdapter } =
  await import("../packages/engine-adapter/dist/index.js");

if (!prompt || !apiToken || !organizationId || !gatewayUrl || !model) {
  usage("Missing prompt, Departify API credentials, gateway URL, or model.");
  process.exit();
}
if (!gatewayToken && !deviceKeyPath && !deviceKeyPem) {
  usage("Missing OpenClaw gateway token or device key.");
  process.exit();
}
if (
  !Number.isFinite(requestTimeoutMs) ||
  !Number.isFinite(connectTimeoutMs) ||
  !Number.isFinite(retryLimit) ||
  !Number.isFinite(maxRetryDelayMs) ||
  !Number.isFinite(httpTimeoutMs)
) {
  usage("Timeout/retry environment variables must be finite numbers.");
  process.exit();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function durations(timeline) {
  const ordered = Object.entries(timeline).sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(
    ordered.map(([stage], index) => {
      const previous = index === 0 ? 0 : ordered[index - 1][1];
      return [stage, round(timeline[stage] - previous)];
    }),
  );
}

function directAdapter() {
  const pem =
    deviceKeyPem ??
    (deviceKeyPath ? readFileSync(deviceKeyPath, "utf8") : undefined);
  return createEngineAdapter({
    provider: "openclaw",
    gatewayUrl,
    ...(gatewayToken ? { gatewayToken } : {}),
    requestTimeoutMs,
    connectTimeoutMs,
    retryLimit,
    maxRetryDelayMs,
    ...(pem ? { deviceKeyPem: pem } : {}),
    model,
  });
}

async function runDirect() {
  const engine = directAdapter();
  const sessionId = `latency-ab-${randomUUID()}`;
  await engine.createSession({ sessionId, model });
  const timeline = {};
  let toolCallCount = 0;
  const started = performance.now();
  const result = await engine.sendMessage({
    sessionId,
    message: prompt,
    timeline: (stage) => {
      timeline[stage] = round(performance.now() - started);
      if (stage === "T9_tool_invocation_started") toolCallCount += 1;
    },
  });
  return {
    status: result.status,
    model,
    ttftMs: timeline.T7_provider_first_event ?? null,
    totalMs: round(performance.now() - started),
    adapterDurationMs: result.durationMs,
    timeline,
    stageDurationsMs: durations(timeline),
    toolCallCount: Math.max(toolCallCount, result.toolCalls?.length ?? 0),
  };
}

async function runDepartify() {
  const correlationId = randomUUID();
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);
  let response;
  try {
    response = await fetch(
      `${apiBaseUrl}/api/customer-zero/${encodeURIComponent(organizationId)}/command-center/message`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
          "x-departify-correlation-id": correlationId,
        },
        body: JSON.stringify({ message: prompt }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Preserve the transport result without logging a response body.
  }
  const reply = typeof body?.reply === "string" ? body.reply : "";
  return {
    httpStatus: response.status,
    completed: response.ok && reply.trim().length > 0,
    responseBytes: Buffer.byteLength(reply, "utf8"),
    totalMs: round(performance.now() - started),
    correlationId:
      response.headers.get("x-departify-correlation-id") ?? correlationId,
    conversationId:
      typeof body?.conversationId === "string" ? body.conversationId : null,
    routingIntent:
      typeof body?.routing?.intent === "string" ? body.routing.intent : null,
    responseToolEventCount: Array.isArray(body?.events)
      ? body.events.filter(
          (event) =>
            event?.kind === "work_state" &&
            /tool/i.test(String(event?.state ?? "")),
        ).length
      : 0,
  };
}

const direct = await runDirect();
const departify = await runDepartify();
const overheadMs = round(departify.totalMs - direct.totalMs);

console.log(
  JSON.stringify(
    {
      promptBytes: Buffer.byteLength(prompt, "utf8"),
      model,
      directOpenClaw: direct,
      departifyPortalApi: departify,
      departifyOverheadMs: overheadMs,
      interpretation: {
        directGenerationSucceeded: direct.status === "completed",
        departifyCompletionSucceeded: departify.completed,
        postGenerationFailureCandidate:
          direct.status === "completed" && !departify.completed,
        productionCorrelationId: departify.correlationId,
        nextStep:
          "Cross productionCorrelationId with Railway [chat-timeline] and [ceo-turn-trace] logs; no response content is printed by this runner.",
      },
    },
    null,
    2,
  ),
);

if (direct.status !== "completed" || !departify.completed) process.exitCode = 1;
