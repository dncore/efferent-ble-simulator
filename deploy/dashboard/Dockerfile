# ─── build stage: React + Vite + shadcn/ui ────────────────────────────────
FROM node:22-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json* ./
COPY . .
RUN npm ci --registry "$NPM_REGISTRY" --no-audit --no-fund && \
    npm run build

# ─── runtime stage: nginx 静态服务 ────────────────────────────────────────
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/ /docker-entrypoint.d/
COPY --from=build /app/dist /usr/share/nginx/html
