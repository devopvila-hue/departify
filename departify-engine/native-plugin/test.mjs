import assert from "node:assert/strict";
import { test } from "node:test";
import plugin, { TOOL_NAMES } from "./index.js";

const ORG_A = "7a9f4986-23ba-4d47-8018-f92e304c539d";
const ORG_B = "8b660597-34cb-5e58-a299-023915cad64e";

function registeredPlugin() {
  let factory;
  let gatewayHandler;
  plugin.register({
    registerGatewayMethod(_name, handler) {
      gatewayHandler = handler;
    },
    registerTool(candidate) {
      factory = candidate;
    },
  });
  return { factory, gatewayHandler };
}

test("registers the closed read-only native tool surface", async () => {
  const { factory, gatewayHandler } = registeredPlugin();
  assert.deepEqual(TOOL_NAMES, [
    "departify.company.context",
    "departify.email.list",
    "departify.email.search",
    "departify.calendar.list",
    "departify.drive.search",
    "departify.drive.read",
    "departify.tasks.list",
    "departify.approvals.list",
    "departify.results.list",
  ]);
  const beforePolicy = factory({ sessionKey: `departify:ceo:${ORG_A}`, agentId: "main" });
  assert.deepEqual(beforePolicy, []);
  let response;
  await gatewayHandler({
    params: { sessionKey: `departify:ceo:${ORG_A}`, agentId: "main", toolNames: TOOL_NAMES },
    respond(ok, result) { response = { ok, result }; },
  });
  assert.deepEqual(response, { ok: true, result: { ok: true, toolCount: 9 } });
  const tools = factory({ sessionKey: `departify:ceo:${ORG_A}`, agentId: "main" });
  assert.equal(tools.length, 9);
  const company = tools.find((tool) => tool.name === "departify.company.context");
  assert.deepEqual(company.parameters.properties.section.enum, ["summary", "objective", "marketing", "all"]);
  assert.equal(company.parameters.additionalProperties, false);
  assert.equal(tools.find((tool) => tool.name === "departify.email.list").parameters.properties.offset.type, "integer");
  assert.deepEqual(tools.find((tool) => tool.name === "departify.calendar.list").parameters.properties.timeOfDay.enum, ["morning", "afternoon", "evening"]);
  assert.equal(tools.some((tool) => tool.name.includes("send") || tool.name.includes("create")), false);
});

test("uses trusted session identity and returns the structured gateway result", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  process.env.DEPARTIFY_API_URL = "http://backend.test";
  process.env.DEPARTIFY_RUNTIME_TOKEN = "runtime-secret";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("runtime-token")) {
      return new Response(JSON.stringify({ token: "scoped-token", audience: "departify-tool-gateway" }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: "success", operation: "departify.email.list", data: { messages: [] } }), { status: 200 });
  };
  try {
    const { factory, gatewayHandler } = registeredPlugin();
    await gatewayHandler({ params: { sessionKey: `departify:ceo:${ORG_A}`, agentId: "main", toolNames: ["departify.email.list"] }, respond() {} });
    const [tool] = factory({ sessionKey: `departify:ceo:${ORG_A}`, agentId: "main" });
    const result = await tool.execute("call-1", { organizationId: "org-b" });
    assert.deepEqual(result.details, { status: "success", operation: "departify.email.list", data: { messages: [] } });
    assert.equal(requests.length, 2);
    assert.match(requests[0].init.body, new RegExp(`departify:ceo:${ORG_A}`));
    assert.doesNotMatch(requests[0].init.body, new RegExp(ORG_B));
    assert.match(requests[1].init.headers.authorization, /^Bearer scoped-token$/);
    assert.match(requests[1].init.body, /departify\.email\.list/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DEPARTIFY_API_URL;
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
  }
});

test("rejects another agent and never exposes a mutation through policy", async () => {
  const { factory, gatewayHandler } = registeredPlugin();
  await assert.rejects(
    () => gatewayHandler({ params: { sessionKey: `agent:other:departify:ceo:${ORG_A}`, agentId: "other", toolNames: TOOL_NAMES }, respond() {} }),
    /scoped CEO session/,
  );
  let response;
  await gatewayHandler({
    params: { sessionKey: `departify:ceo:${ORG_A}`, agentId: "main", toolNames: ["departify.email.send", "unknown", "departify.calendar.list"] },
    respond(ok, result) { response = { ok, result }; },
  });
  assert.deepEqual(response, { ok: true, result: { ok: true, toolCount: 1 } });
  assert.deepEqual(factory({ sessionKey: `departify:ceo:${ORG_A}`, agentId: "main" }).map((tool) => tool.name), ["departify.calendar.list"]);
});

test("rejects a malformed organization session before any gateway request", async () => {
  const { factory } = registeredPlugin();
  assert.throws(
    () => factory({ sessionKey: "departify:ceo:engine032fresh20260812", agentId: "main" }),
    /scoped CEO session/,
  );
});
