# syntax=docker/dockerfile:1.7
#
# Departify Engine — OpenClaw Gateway container.
#
# Builds on the OFFICIAL OpenClaw image. The base image is pinned by digest
# for reproducibility. We add only:
#   - the config renderer (scripts/render-config.mjs)
#   - the entrypoint that runs the renderer and then execs the gateway
#   - a minimal workspace bootstrap
#
# Reference: https://github.com/openclaw/openclaw
# Version:   v2026.7.1-2 (Latest stable, 2026-08-04)
# Image:     ghcr.io/openclaw/openclaw:2026.7.1-2-slim

ARG OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:2026.7.1-2-slim"
FROM ${OPENCLAW_IMAGE}

ARG OPENCLAW_VERSION="v2026.7.1-2"
ARG ENGINE_VERSION="engine-01-2026.08.09"
ARG BUILD_TIMESTAMP=""
ARG GIT_COMMIT=""

LABEL org.opencontainers.image.title="departify-engine" \
      org.opencontainers.image.description="Departify internal engine runtime (OpenClaw Gateway)" \
      org.opencontainers.image.source="https://github.com/devopvila-hue/rosa" \
      org.opencontainers.image.licenses="Proprietary" \
      org.opencontainers.image.version="${ENGINE_VERSION}" \
      org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      departify.engine.openclaw_version="${OPENCLAW_VERSION}" \
      departify.engine.role="internal-only"

ENV OPENCLAW_VERSION=${OPENCLAW_VERSION} \
    ENGINE_VERSION=${ENGINE_VERSION} \
    NODE_ENV=production \
    COREPACK_HOME=/usr/local/share/corepack

# Engine artefacts (renderer, entrypoint, bootstrap). These are read-only.
COPY --chown=root:root --chmod=0755 scripts/entrypoint.sh /app/scripts/entrypoint.sh
COPY --chown=root:root --chmod=0755 scripts/render-config.mjs /app/scripts/render-config.mjs
COPY --chown=root:root --chmod=0644 bootstrap/ /app/bootstrap/

# Health probe: combine /healthz (liveness) and /readyz (readiness) by hitting
# the same loopback port the gateway binds to. The official docker-healthcheck.js
# already does this; we keep our wrapper to log outcomes in the container logs.
COPY --chown=root:root --chmod=0755 scripts/healthcheck.sh /usr/local/bin/healthcheck

# Override the official entrypoint so we run our renderer first. The official
# ENTRYPOINT is `tini -s -- node openclaw.mjs gateway`; we keep tini and add
# our wrapper script before it.
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/app/scripts/entrypoint.sh"]
CMD []

# Quick metadata layer for image inspectors.
RUN echo "departify-engine ${ENGINE_VERSION} (openclaw ${OPENCLAW_VERSION})" \
      > /app/.departify-engine-release && \
    chmod 0644 /app/.departify-engine-release

# The container runs as root ONLY for the entrypoint so it can chown Railway
# volume mounts (which are root-owned by default) to the `node` user. The
# entrypoint drops to `node` (uid 1000) via setpriv before launching the
# gateway, so the OpenClaw process itself is non-root.
USER root
