const TOOL_NAME = "departify.company.context";
const DEFAULT_AUDIENCE = "departify-tool-gateway";

function runtimeConfig() {
  const apiUrl = process.env.DEPARTIFY_API_URL?.trim();
  const runtimeToken = process.env.DEPARTIFY_RUNTIME_TOKEN?.trim();
  if (!apiUrl || !runtimeToken) {
    throw new Error("Departify native tool gateway is not configured");
  }
  return { apiUrl: apiUrl.replace(/\/$/, ""), runtimeToken };
}

function sessionKeyFromContext(ctx) {
  const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey.trim() : "";
  const agentId = typeof ctx?.agentId === "string" ? ctx.agentId.trim() : "main";
  if (agentId !== "main" || !/^(?:departify:ceo:|agent:main:departify:ceo:)[^:]+$/.test(sessionKey)) {
    throw new Error("Departify native tool requires a scoped CEO session");
  }
  return sessionKey;
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error("Departify native tool gateway rejected the request");
  }
  return body;
}

async function executeCompanyContext(ctx, params) {
  const sessionKey = sessionKeyFromContext(ctx);
  const { apiUrl, runtimeToken } = runtimeConfig();
  const tokenResponse = await fetch(`${apiUrl}/internal/native-tools/runtime-token`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtimeToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sessionKey }),
  });
  const scoped = await readJson(tokenResponse);
  if (typeof scoped.token !== "string" || scoped.audience !== DEFAULT_AUDIENCE) {
    throw new Error("Departify native tool did not receive a scoped token");
  }
  const contextResponse = await fetch(`${apiUrl}/internal/native-tools/company-context`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${scoped.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ section: params?.section }),
  });
  return await readJson(contextResponse);
}

export default {
  id: "departify-native-tools",
  name: "Departify Native Tools",
  description: "Native read-only Departify business context tools.",
  register(api) {
    api.registerTool((ctx) => [{
      name: TOOL_NAME,
      label: "Departify Company Context",
      description:
        "Read the current verified company context from Departify. Use this for questions about what the company knows, its current objective, or what Marketing is doing. The organization is derived from the active Departify session; never request or provide an organization id.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["summary", "objective", "marketing", "all"],
            description: "Optional bounded section of the company context.",
          },
        },
        additionalProperties: false,
      },
      execute: async (_toolCallId, params) => {
        const result = await executeCompanyContext(ctx, params);
        const text = JSON.stringify(result);
        return {
          content: [{ type: "text", text }],
          details: result,
        };
      },
    }], { names: [TOOL_NAME] });
  },
};
