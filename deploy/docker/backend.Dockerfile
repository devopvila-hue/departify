FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

# Workspace manifests: root + full packages graph. Copying all of packages/
# keeps the install layer independent of future workspace dependency changes —
# no per-package Dockerfile patching required.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/ packages/

RUN pnpm install --frozen-lockfile

# Full source for the backend (packages source is already present).
COPY apps/backend apps/backend

# Build the backend together with its full transitive workspace dependency
# graph. pnpm resolves the graph from the workspace and runs builds in
# topological order (dependencies first), so every @departify/* package the
# backend imports produces its dist + type declarations before backend tsc runs.
RUN pnpm --filter @departify/backend... run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3210

WORKDIR /app

RUN corepack enable

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/backend ./apps/backend

EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3210') + '/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@departify/backend", "start"]
