# Misthos worker (Railway). Build context: repository root.
# Docker Official Images through AWS's public mirror: Railway's builders hit Docker Hub's pull limit (429).
FROM public.ecr.aws/docker/library/node:22-slim
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Install only what the worker needs, from the lockfile (cached until a manifest changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/agent/package.json packages/agent/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@misthos/worker..."

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/agent packages/agent
COPY apps/worker apps/worker

ENV NODE_ENV=production
WORKDIR /app/apps/worker
USER node
# tsx runs the TypeScript directly and forwards SIGTERM, so the worker shuts down gracefully on redeploy.
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
