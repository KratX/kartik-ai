# syntax=docker/dockerfile:1.7
# Kartik.ai API Gateway Multi-Stage Root-Context Dockerfile (Blueprint v4.3 §4.6 & Phase 16)
# Build from repository root:
#   docker build -f backend/gateway/Dockerfile -t kartik-ai/gateway:latest .

FROM node:22-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/tsconfig.json ./backend/shared/
COPY backend/gateway/package.json backend/gateway/tsconfig.json ./backend/gateway/

RUN pnpm install --frozen-lockfile --filter @kartik/shared --filter @kartik/gateway

COPY backend/shared ./backend/shared
COPY backend/gateway ./backend/gateway

RUN pnpm --filter @kartik/shared run build && pnpm --filter @kartik/gateway run build

FROM node:22-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=8000

COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /workspace/backend/shared/dist ./backend/shared/dist
COPY --from=builder /workspace/backend/gateway/package.json ./backend/gateway/package.json
COPY --from=builder /workspace/backend/gateway/dist ./backend/gateway/dist

USER node
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/healthz || exit 1

CMD ["node", "backend/gateway/dist/src/index.js"]
