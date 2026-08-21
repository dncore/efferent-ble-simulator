# ─── build stage ──────────────────────────────────────────────────────────
# 零编译：better-sqlite3（唯一原生模块）通过 prebuild-install 下载预编译二进制。
# 默认从 GitHub Releases 获取；网络受限时可用 ARG 切换到镜像源（见下方说明）。
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG BETTER_SQLITE3_BINARY_HOST_MIRROR=

FROM node:22-bookworm-slim AS build
ARG NPM_REGISTRY
ARG BETTER_SQLITE3_BINARY_HOST_MIRROR
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN if [ -n "$BETTER_SQLITE3_BINARY_HOST_MIRROR" ]; then \
      export npm_config_better_sqlite3_binary_host_mirror="$BETTER_SQLITE3_BINARY_HOST_MIRROR"; \
    fi; \
    npm ci --registry "$NPM_REGISTRY" --no-audit --no-fund && \
    npm run build && \
    npm prune --omit=dev

# ─── runtime stage ────────────────────────────────────────────────────────
# 只复制产物，不再安装任何东西（更快、更小、无网络依赖）
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV MCP_TRANSPORT=http
ENV MCP_PORT=3300
ENV MCP_HOST=0.0.0.0
EXPOSE 3300

CMD ["node", "dist/index.js"]
