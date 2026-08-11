import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HostingerEmailAdapter,
  HostingerEmailError,
  mapDiscoveredCapabilities,
} from "../src/customer-zero/hostinger-email-adapter.js";
import { InboxSync } from "../src/customer-zero/inbox-sync.js";
import { InMemoryInboxStore } from "../src/customer-zero/inbox-domain.js";

function jsonResponse(body: unknown, sessionId?: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe("Hostinger Email MCP adapter", () => {
  afterEach(() => {
    delete process.env.HOSTINGER_EMAIL_MCP_TOKEN;
    delete process.env.HOSTINGER_EMAIL_MCP_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails closed without a token and never exposes credential values", async () => {
    const adapter = new HostingerEmailAdapter({ token: "", url: "https://mcp.mail.hostinger.com/mcp" });
    await expect(adapter.discover()).rejects.toMatchObject({ category: "MCP_AUTH_FAILED" });
  });

  it("initializes, discovers actual tools, maps capabilities, and normalizes messages", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("MCP-Protocol-Version")).toBe("2025-06-18");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method: String(body.method), body });
      if (body.method === "initialize") {
        return jsonResponse({ result: { protocolVersion: "2025-06-18" } }, "session-test");
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") {
        return jsonResponse({
          result: {
            tools: [
              { name: "list_messages", description: "List recent email messages", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
              { name: "search_messages", description: "Search mail by query", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
              { name: "send_message", description: "Send an email message", inputSchema: { type: "object", properties: { to: { type: "array" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
              { name: "reply_message", description: "Reply to a message", inputSchema: { type: "object", properties: { messageId: { type: "string" }, body: { type: "string" } }, required: ["messageId", "body"] } },
              { name: "list_mailboxes", description: "List mailboxes", inputSchema: { type: "object", properties: {} } },
            ],
          },
        });
      }
      if (body.method === "tools/call" && (body.params as { name: string }).name === "list_messages") {
        return jsonResponse({ result: { content: [{ type: "text", text: JSON.stringify({ messages: [{ id: "host-msg-1", threadId: "host-thread-1", from: { email: "alex@empresa.com", name: "Alex" }, subject: "Presupuesto", snippet: "Te envío el presupuesto", date: "2026-08-11T10:00:00.000Z", unread: true }] }) }] } });
      }
      if (body.method === "tools/call" && (body.params as { name: string }).name === "list_mailboxes") {
        return jsonResponse({ result: { content: [{ type: "text", text: JSON.stringify({ mailboxes: ["ventas@empresa.com"] }) }] } });
      }
      throw new Error(`unexpected method ${String(body.method)}`);
    }) as unknown as typeof fetch;

    const adapter = new HostingerEmailAdapter({ token: "secret-token", url: "https://mcp.mail.hostinger.com/mcp", fetchImpl });
    const mapping = await adapter.discover();
    expect(mapping.capabilities["email.read"]).toBe("list_messages");
    expect(mapping.capabilities["email.search"]).toBe("search_messages");
    expect(mapping.capabilities["email.send"]).toBe("send_message");
    expect(mapping.capabilities["email.reply"]).toBe("reply_message");

    const messages = await adapter.readRecentMessages(3);
    expect(messages[0]).toMatchObject({
      provider: "hostinger",
      providerMessageId: "host-msg-1",
      providerThreadId: "host-thread-1",
      subject: "Presupuesto",
      from: { email: "alex@empresa.com" },
      unread: true,
    });
    await expect(adapter.listMailboxes()).resolves.toEqual(["ventas@empresa.com"]);
    expect(calls.map((call) => call.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "tools/call",
    ]);
    expect(JSON.stringify(calls)).not.toContain("secret-token");
  });

  it("maps only capabilities represented by discovered tools", () => {
    const mapping = mapDiscoveredCapabilities([
      { name: "send_message", description: "Send an email" },
      { name: "random_tool", description: "Manage settings" },
    ]);
    expect(mapping["email.send"]).toBe("send_message");
    expect(mapping["email.read"]).toBeUndefined();
    expect(mapping["email.delete"]).toBeUndefined();
  });

  it("returns provider message evidence for send and rejects an unconfirmed send", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (body.method === "initialize") return jsonResponse({ result: {} }, "session-send");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return jsonResponse({ result: { tools: [{ name: "send_message", description: "Send an email", inputSchema: { type: "object", properties: { to: {}, subject: {}, body: {} }, required: ["to", "subject", "body"] } }] } });
      return jsonResponse({ result: { messageId: "host-sent-1" } });
    }) as unknown as typeof fetch;
    const adapter = new HostingerEmailAdapter({ token: "secret-token", fetchImpl });
    const result = await adapter.sendMessage({ to: ["ceo@example.com"], subject: "Prueba", bodyText: "Hola" });
    expect(result.providerMessageId).toBe("host-sent-1");

    const noEvidenceFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (body.method === "initialize") return jsonResponse({ result: {} }, "session-empty");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return jsonResponse({ result: { tools: [{ name: "send_message", description: "Send an email", inputSchema: { type: "object", properties: { to: {}, subject: {}, body: {} }, required: ["to", "subject", "body"] } }] } });
      return jsonResponse({ result: { accepted: true } });
    }) as unknown as typeof fetch;
    await expect(new HostingerEmailAdapter({ token: "secret-token", fetchImpl: noEvidenceFetch }).sendMessage({ to: ["ceo@example.com"], subject: "Prueba", bodyText: "Hola" })).rejects.toMatchObject({ category: "MCP_TOOL_CALL_FAILED" });
  });

  it("supports replies only through the discovered reply tool and requires provider evidence", async () => {
    const calls: Array<{ method: string; name?: string; arguments?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      calls.push({
        method: body.method ?? "",
        ...(body.params?.name ? { name: body.params.name } : {}),
        ...(body.params?.arguments ? { arguments: body.params.arguments } : {}),
      });
      if (body.method === "initialize") return jsonResponse({ result: {} }, "session-reply");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return jsonResponse({ result: { tools: [
        { name: "reply_message", description: "Reply to an email message", inputSchema: { type: "object", properties: { messageId: {}, body: {} }, required: ["messageId", "body"] } },
      ] } });
      return jsonResponse({ result: { content: [{ type: "text", text: JSON.stringify({ messageId: "host-reply-1" }) }] } });
    }) as unknown as typeof fetch;
    const result = await new HostingerEmailAdapter({ token: "secret-token", fetchImpl }).replyMessage({ messageId: "host-incoming-1", bodyText: "Lo reviso mañana." });
    expect(result.providerMessageId).toBe("host-reply-1");
    expect(calls.at(-1)).toMatchObject({ method: "tools/call", name: "reply_message", arguments: { messageId: "host-incoming-1", body: "Lo reviso mañana." } });
  });

  it("sanitizes auth and timeout categories", async () => {
    const authFetch = vi.fn(async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    await expect(new HostingerEmailAdapter({ token: "secret-token", fetchImpl: authFetch }).discover()).rejects.toMatchObject({ category: "MCP_AUTH_FAILED" });
    const timeoutFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (init?.signal?.aborted) throw new Error("aborted");
      return jsonResponse({ result: {} });
    }) as unknown as typeof fetch;
    await expect(new HostingerEmailAdapter({ token: "secret-token", fetchImpl: timeoutFetch }).discover()).rejects.toBeInstanceOf(HostingerEmailError);
  });

  it("imports Hostinger messages into the same normalized Inbox store", async () => {
    process.env.HOSTINGER_EMAIL_MCP_TOKEN = "secret-token";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: { name?: string } };
      if (body.method === "initialize") return jsonResponse({ result: {} }, "session-inbox");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return jsonResponse({ result: { tools: [
        { name: "list_messages", description: "List recent email messages", inputSchema: { type: "object", properties: { limit: {} } } },
      ] } });
      if (body.method === "tools/call" && body.params?.name === "list_messages") return jsonResponse({ result: { content: [{ type: "text", text: JSON.stringify({ messages: [{ id: "host-inbox-1", from: { email: "cliente@empresa.com", name: "Cliente" }, to: [{ email: "ceo@empresa.com" }], subject: "Consulta de precio", snippet: "Necesito información y presupuesto", date: "2026-08-11T12:00:00.000Z", unread: true }] }) }] } });
      return jsonResponse({ result: {} });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const store = new InMemoryInboxStore();
    const result = await new InboxSync(store).run({ organizationId: "org-hostinger", userId: "user-a", maxResults: 3 });
    expect(result.imported).toBe(1);
    const items = await store.list({ organizationId: "org-hostinger" });
    expect(items[0]).toMatchObject({ source: "hostinger", sourceMessageId: "host-inbox-1", subject: "Consulta de precio" });
    delete process.env.HOSTINGER_EMAIL_MCP_TOKEN;
  });
});
