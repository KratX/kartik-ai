# syntax=docker/dockerfile:1.7
# Kartik.ai Billing Service Multi-Stage Root-Context Dockerfile (Blueprint v4.3 §4.6 & Phase 16)
# Build from repository root:
#   docker build -f backend/services/billing/Dockerfile -t kartik-ai/billing:latest .

FROM node:22-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/tsconfig.json ./backend/shared/
COPY backend/services/billing/package.json backend/services/billing/tsconfig.json ./backend/services/billing/

RUN pnpm install --frozen-lockfile --filter @kartik/shared --filter @kartik/billing

COPY backend/shared ./backend/shared
COPY backend/services/billing ./backend/services/billing

RUN pnpm --filter @kartik/shared run build && pnpm --filter @kartik/billing run build

FROM node:22-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=8004
ENV BILLING_MODE=mock

COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /workspace/backend/shared/dist ./backend/shared/dist
COPY --from=builder /workspace/backend/services/billing/package.json ./backend/services/billing/package.json
COPY --from=builder /workspace/backend/services/billing/dist ./backend/services/billing/dist

USER node
EXPOSE 8004

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8004/healthz || exit 1

CMD ["node", "backend/services/billing/dist/src/index.js"]
