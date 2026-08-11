# Hostinger Email

Departify integrates Hostinger Email through a server-side provider adapter.
The MCP protocol is not exposed to the CEO, portal, or model.

Backend-only configuration:

```text
HOSTINGER_EMAIL_MCP_URL=https://mcp.mail.hostinger.com/mcp
HOSTINGER_EMAIL_MCP_TOKEN=<Railway secret>
```

`HOSTINGER_EMAIL_MCP_URL` defaults to the official endpoint when omitted.
`HOSTINGER_EMAIL_MCP_TOKEN` must be configured in Railway or the backend's
secure secret store. Never put it in the portal environment, source control,
chat, logs, or execution receipts.

At runtime Departify initializes the remote MCP session and calls `tools/list`.
Capabilities are mapped only from the tools actually returned by Hostinger;
tool names and argument shapes are not hardcoded. A capability is used only
after its discovered tool returns a provider-backed result.

The current vertical slice supports recent reads, search, normalized Unified
Inbox import, new sends with the existing approval gate, and explicit replies
when Hostinger exposes compatible tools. Folder, mailbox, move, flag, delete,
and webhook capabilities are discovered and surfaced only when the returned
tools support them; unsupported operations remain unavailable.
