# syntax=docker/dockerfile:1.7
# Kartik.ai Frontend SPA + Single-Origin Nginx Reverse Proxy Dockerfile (Blueprint v4.3 §2.1, §4.6 & Phase 16)
# Build from repository root:
#   docker build -f frontend/Dockerfile -t kartik-ai/frontend:latest .

FROM node:26-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/tsconfig.json ./backend/shared/
COPY frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./frontend/

RUN pnpm install --frozen-lockfile --filter . --filter @kartik/shared --filter @kartik/frontend

COPY public ./public
COPY backend/shared ./backend/shared
COPY frontend ./frontend

RUN pnpm --filter @kartik/shared run build && pnpm --filter @kartik/frontend run build

FROM nginx:1.27-alpine AS runner
RUN rm -rf /usr/share/nginx/html/*
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/frontend/dist /usr/share/nginx/html
RUN rm -rf /usr/share/nginx/html/src /usr/share/nginx/html/tests && test -f /usr/share/nginx/html/index.html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/nginx-healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
