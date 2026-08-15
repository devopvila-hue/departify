# Ads Connector Architecture

Verified 2026-08-15. This document is the source of truth for the first-party advertising execution slice. Provider contracts drift; the MCP runtime discovers tools and schemas at connection time instead of hardcoding provider tool contracts.

## Product boundary

The CEO connects `Meta Ads`, `Google Ads`, or `TikTok Ads` from Departify. The portal does not expose MCP, Activepieces, OpenClaw, pieces, runtimes, provider tool names, OAuth tokens, developer tokens, or account credentials.

The backend owns the canonical organization connection state. A provider-side connection is not a Departify connection until the organization-scoped state is verified and persisted.

## Provider selection

The runtime applies this order for each business capability:

1. first-party official MCP;
2. first-party official API;
3. existing proven connector;
4. Activepieces Community;
5. custom adapter.

Marketing requests capabilities, never providers. The selector is implemented in `@departify/connector-runtime`; provider-specific adapters are behind that boundary.

## Meta Ads

Endpoint verified by live unauthenticated probe: `https://mcp.facebook.com/ads`.

The endpoint is a remote, POST-only Streamable HTTP MCP server. An unauthenticated `initialize` request returns `401` with protected-resource metadata and the currently advertised scopes:

`ads_management`, `ads_read`, `catalog_management`, `business_management`, `pages_show_list`, `instagram_basic`, `ads_mcp_management`.

The server is authenticated with a Bearer header. The MCP runtime performs `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`; it treats tool names and input schemas as discovered provider data. The runtime maps Departify capabilities to discovered tools through explicit hints when available, then a conservative semantic match.

Meta Ads is separate from organic Facebook Pages / Instagram publishing. The existing `Meta Business` OAuth flow remains the organic/general Meta connection; the `Meta Ads` product card projects the paid advertising capability onto that verified connection until Meta’s Ads MCP OAuth can be completed directly inside Departify.

Real account access remains founder-gated: Meta OAuth consent, a permitted Business/Ads account, and any Meta review or business verification requirements must be completed before a real read can run.

## TikTok Ads

TikTok’s official documentation confirms a TikTok for Business MCP Server based on MCP and describes campaign management, performance reporting, audience configuration, and creative operations. TikTok’s official API for Business documentation also states that its Marketing API handles account, reporting, campaign, ad group, ad, creative, and optimization operations.

TikTok access is not assumed configured. The runtime accepts a configured official MCP endpoint through `TIKTOK_ADS_MCP_ENDPOINT`, discovers its tools, and keeps the connection unavailable until the TikTok advertiser / Business Center relationship and consent are verified. TikTok’s reviewed developer-app/account requirements are a founder action, not a client-side configuration requirement.

## Google Ads

Google’s official Ads MCP is used for the read/report/analyze path. Google’s official launch announcement describes the initial MCP release as read-only, so Departify does not invent MCP writes.

Google Ads writes use the separate official Google Ads API adapter only when the secure runtime has all required configuration: OAuth access, developer token, and a canonical connected customer ID. The customer ID is resolved by the credential boundary and cannot be supplied by the request body. Manager-account calls may also require `login-customer-id`.

The adapter sends only the approved `mutateOperations` payload to the official API. It does not expose access tokens, refresh tokens, developer tokens, or raw provider errors. Google Ads API writes are still blocked by the durable CEO approval gate.

Google’s official requirements include:

- OAuth 2.0 credentials and the `https://www.googleapis.com/auth/adwords` scope;
- a developer token for every API call;
- a 10-digit client customer ID, without hyphens;
- `login-customer-id` when acting through a manager account;
- appropriate account access and API access level.

## Capability availability

The registry includes the shared family for each platform:

`read`, `report`, `analyze`, `create`, `manage`, `pause`, `resume`, `budget.manage`, `audience.manage`, and `creative.manage`.

Only capabilities actually present in the verified connection projection are sent to Elvira. Google Ads’ initial connection exposes read/report/analyze; write capabilities are not advertised until the official API path is configured and verified.

## Approval and money safety

Read/report/analyze operations are autonomous. Create, activation, pause/resume, budget, bid/targeting, audience, and creative mutations are prepared first and require a durable approved Marketing approval for the exact organization and operation. A model-generated “approved” message is never accepted.

The runtime rejects tenant, provider-account, credential-reference, token, and developer-token overrides from request input. Provider account selection must come from the canonical connected account.

## Results and verification

Provider output remains inside the connector boundary until normalized. Secret-shaped fields are redacted. Important writes use the provider response as evidence and should add a read-after-write verification step before the product says that a campaign changed.

## Deployment

Activepieces remains a separate healthy Railway service for general SaaS integrations. The ads MCP runtimes do not require a new container: they are reusable backend runtime instances configured by environment and secure credential closures.

Optional runtime variables:

```text
META_ADS_MCP_ENDPOINT=https://mcp.facebook.com/ads
TIKTOK_ADS_MCP_ENDPOINT=
GOOGLE_ADS_MCP_ENDPOINT=
GOOGLE_ADS_ACCESS_TOKEN=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

Secret values must be stored in Railway’s secret store and must never be committed or sent to OpenClaw, the portal, or chat.

## Official sources

- [Meta Ads MCP endpoint](https://mcp.facebook.com/ads) — live protocol and protected-resource probe verified 2026-08-15.
- [TikTok for Business Agentic Hub and MCP Server](https://ads.tiktok.com/help/article/about-tiktok-for-business-agentic-hub-and-mcp-server?lang=en-GB) — official MCP scope and capability description, updated July 2026.
- [TikTok API for Business guide](https://business-api.tiktok.com/gateway/docs/index) — official setup, authorization, permissions, account, rate-limit, and MCP guide index.
- [Google Ads MCP announcement](https://ads-developers.googleblog.com/2025/10/open-source-google-ads-api-mcp-server.html) — official read-only launch statement.
- [Google Ads authorization and headers](https://developers.google.com/google-ads/api/rest/auth) — OAuth, developer token, customer ID, manager account, and request headers.
- [Google Ads credential management](https://developers.google.com/google-ads/api/docs/oauth/credential-management) — secure app/user credential handling and token lifetime.

## Founder action pack

### Meta

1. Sign in to the Meta Ads account and authorize Departify’s Meta connection when the OAuth flow is available.
2. Select the Business / Ads account that should be visible to Departify.
3. Grant the scopes advertised by Meta’s protected-resource metadata; Meta may require business verification, app review, or account/page terms.
4. Return to Departify and run the connection verification. The next automated test is an authenticated `initialize → tools/list → read/report` call followed by a durable Marketing Result.

### TikTok

1. Sign in to TikTok for Business and ensure the advertiser account is related to the intended Business Center.
2. Complete any TikTok developer-app review or production access required for the account and country.
3. Authorize Departify and select the advertiser account.
4. Return to Departify and run the connection verification. The next automated test is `initialize → tools/list → reporting read` followed by a durable Marketing Result.

### Google Ads

1. Sign in to the Google Ads manager account and obtain an approved developer token from the API Center.
2. Ensure the Google Cloud OAuth app is configured with `https://www.googleapis.com/auth/adwords` and the canonical callback.
3. Authorize the intended client customer account; if using a manager account, provide its login customer ID through the secure connection record.
4. Return to Departify and run the connection verification. The next automated test is a real campaigns/metrics read through Google Ads MCP. Google API writes remain unavailable until the developer token and write credentials are verified; no live-spend test is run.
