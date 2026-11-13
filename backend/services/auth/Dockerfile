# syntax=docker/dockerfile:1.7
# Kartik.ai Auth Service Multi-Stage Root-Context Dockerfile (Blueprint v4.3 §4.6 & Phase 16)
# Build from repository root:
#   docker build -f backend/services/auth/Dockerfile -t kartik-ai/auth:latest .

FROM node:22-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/tsconfig.json ./backend/shared/
COPY backend/services/auth/package.json backend/services/auth/tsconfig.json ./backend/services/auth/

RUN pnpm install --frozen-lockfile --filter @kartik/shared --filter @kartik/auth

COPY backend/shared ./backend/shared
COPY backend/services/auth ./backend/services/auth

RUN pnpm --filter @kartik/shared run build && pnpm --filter @kartik/auth run build

FROM node:22-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=8001

COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /workspace/backend/shared/dist ./backend/shared/dist
COPY --from=builder /workspace/backend/services/auth/package.json ./backend/services/auth/package.json
COPY --from=builder /workspace/backend/services/auth/dist ./backend/services/auth/dist

USER node
EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8001/healthz || exit 1

CMD ["node", "backend/services/auth/dist/src/index.js"]
