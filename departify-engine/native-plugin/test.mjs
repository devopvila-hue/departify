import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "./index.js";

test("registers the native company context tool with a closed schema", async () => {
  let factory;
  plugin.register({
    registerTool(candidate) {
      factory = candidate;
    },
  });
  assert.equal(typeof factory, "function");
  const tools = factory({ sessionKey: "departify:ceo:org-a", agentId: "main" });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "departify.company.context");
  assert.deepEqual(tools[0].parameters.properties.section.enum, [
    "summary",
    "objective",
    "marketing",
    "all",
  ]);
  assert.equal(tools[0].parameters.additionalProperties, false);
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
    return new Response(JSON.stringify({ status: "success", organization: { id: "org-a" }, company: { name: "A" } }), { status: 200 });
  };
  try {
    let factory;
    plugin.register({ registerTool(candidate) { factory = candidate; } });
    const [tool] = factory({ sessionKey: "departify:ceo:org-a", agentId: "main" });
    const result = await tool.execute("call-1", { section: "summary", organizationId: "org-b" });
    assert.deepEqual(result.details, { status: "success", organization: { id: "org-a" }, company: { name: "A" } });
    assert.equal(requests.length, 2);
    assert.match(requests[0].init.body, /departify:ceo:org-a/);
    assert.doesNotMatch(requests[0].init.body, /org-b/);
    assert.match(requests[1].init.headers.authorization, /^Bearer scoped-token$/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DEPARTIFY_API_URL;
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
  }
});

test("accepts OpenClaw's scoped agent session key but rejects another agent", async () => {
  let factory;
  plugin.register({ registerTool(candidate) { factory = candidate; } });
  assert.doesNotThrow(() => factory({ sessionKey: "agent:main:departify:ceo:org-a", agentId: "main" }));
  await assert.rejects(
    () => factory({ sessionKey: "agent:other:departify:ceo:org-a", agentId: "other" })[0].execute("call-2", {}),
    /scoped CEO session/,
  );
});
