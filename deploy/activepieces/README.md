# Activepieces Connector Runtime PoC

## Deployment decision

Activepieces is deployed in the existing Railway project and production environment as an independent service. It is not installed in or coupled to `departify-engine`.

```text
Departify API ──private Railway network──> Activepieces (pinned image)
     │                                      │
     │                                      ├── managed Postgres (durable state)
     │                                      └── managed Redis (queue/state)
     └──> OpenClaw engine (existing boundary; unchanged)
```

This placement keeps private service-to-service traffic inside Railway, gives Activepieces its own deploy/rollback/health lifecycle, and prevents OpenClaw from becoming a credential or connector host. The Activepieces service is exposed only as needed for its UI/webhook ingress; the backend calls the private hostname.

## Pinned runtime

- Image: `ghcr.io/activepieces/activepieces:0.88.0`
- Container mode: `WORKER_AND_APP` for this PoC
- Healthcheck: `GET /api/v1/health`
- Cache volume: `/usr/src/app/cache`
- Database: managed PostgreSQL, referenced through `AP_POSTGRES_URL`
- Queue: managed Redis, referenced through `AP_REDIS_URL`

Activepieces' single-container PGLite/in-memory Redis mode is intended for personal/testing use. This PoC uses managed Postgres and Redis so tenant/flow state survives container replacement. S3 file storage is intentionally deferred until the runtime needs larger file payloads or multiple workers.

## Required Activepieces variables

Set these in Railway on the Activepieces service. Generate the two secrets with a password generator or `openssl`; never commit them.

```text
AP_FRONTEND_URL=https://<activepieces-public-domain>
AP_DB_TYPE=POSTGRES
AP_POSTGRES_URL=${{<postgres-service>.DATABASE_URL}}
AP_REDIS_TYPE=STANDALONE
AP_REDIS_URL=${{<redis-service>.REDIS_URL}}
AP_ENCRYPTION_KEY=<32-character-secret>
AP_JWT_SECRET=<long-random-secret>
AP_CONTAINER_TYPE=WORKER_AND_APP
AP_TELEMETRY_ENABLED=false
AP_WORKER_CONCURRENCY=1
AP_EXECUTION_MODE=SANDBOX_CODE_ONLY
AP_REUSE_SANDBOX=true
```

The backend service receives only:

```text
ACTIVEPIECES_BASE_URL=http://${{activepieces.RAILWAY_PRIVATE_DOMAIN}}
ACTIVEPIECES_WEBHOOK_SIGNING_SECRET=<separate-random-secret>
ACTIVEPIECES_CONNECTOR_TIMEOUT_MS=30000
```

`ACTIVEPIECES_META_ADS_WEBHOOK_PATH` remains unset until the Meta flow is created. The capability can still be prepared and validated; execution stops with `credential_required` before Activepieces until the tenant's OAuth connection is verified.

## Credential boundary

Departify sends a signed, tenant-bound envelope containing request identity, capability, side-effect classification, and business input. It rejects credential-shaped input fields before network execution. Meta credentials are stored in the Activepieces connection/flow and are never copied to the backend request, OpenClaw, the portal, logs, or normalized results.

## Railway runbook

Create two managed services (`PostgreSQL`, `Redis`) and one empty service named `activepieces` in the existing production environment. Configure the image and variables above, attach a small persistent volume at `/usr/src/app/cache`, generate a public domain for `AP_FRONTEND_URL`, and deploy. Verify the deployment reaches `SUCCESS`, then check:

```text
GET https://<activepieces-public-domain>/api/v1/health
```

The API's `ACTIVEPIECES_BASE_URL` should use the private hostname, not the public domain. Keep `departify-engine` unchanged.
