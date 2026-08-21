# Docker Compose 部署（MCP 服务 + Dashboard + Skill HTTP）

> 设计日期：2026-08-20
> 目标：在其他主机上一键启动 HTTP MCP 服务，提供 Dashboard WebUI 与 Skill
> 文件下载，长期运行。

## What changed

新增 `deploy/` 目录与 `scripts/docker-up.sh`，用 docker-compose 编排三个能力：

1. **mcp 服务**：HTTP 模式的 BLE Simulator MCP 服务（原有代码，容器化运行）
2. **dashboard**：静态 WebUI，轮询展示 MCP 服务 / BLE 模拟器状态，同源代理
   `/mcp`，并提供 **Skill 文件下载**（`http://<host>:3330/skill/SKILL.md`）
3. **一键启动脚本**：宿主机准备（BlueZ / D-Bus 策略，复用 `scripts/setup.sh`）
   + BlueZ 版本检查（≥ 5.87）+ `docker compose up -d --build`

## Key design decisions

1. **BLE 外设只能跑在宿主机**：模拟器通过 D-Bus 调用宿主机 BlueZ 注册 GATT
   与广播。容器**不能**拥有蓝牙适配器，因此 mcp 容器：
   - 挂载宿主机 D-Bus socket：`/run/dbus/system_bus_socket` 与
     `/var/run/dbus/system_bus_socket`
   - 宿主机必须已安装 BlueZ 并写入 D-Bus 策略（`scripts/setup.sh` 负责），
     BlueZ ≥ 5.87（5.86 有广告注册 bug，见 `docs/design/ride-script-scenario.md`
     同源问题与 SKILL.md Prerequisites）
2. **同源代理避免 CORS**：dashboard 容器内 nginx 把 `/mcp` 反代到 mcp 服务，
   Dashboard 页面与 MCP 端点同源，浏览器 fetch 无需 CORS。SSE 响应需
   `proxy_buffering off`。
3. **数据持久化**：`data/`（SQLite）用命名卷 `ble-data` 挂到 `/app/data`，
   容器重建不丢会话/日志。DB 路径相对 CWD（`src/database.ts` 的
   `path.resolve(process.cwd(), 'data')`），故容器 `WORKDIR=/app`。
4. **Skill 文件随仓库同步**：nginx 以只读卷挂载仓库根 `SKILL.md`，保持与
   代码同源，不复制进镜像。
5. **长期运行**：所有服务 `restart: unless-stopped`；mcp 加 healthcheck
   （node fetch 探测 `/mcp`）。
6. **Ubuntu/AppArmor 例外**：Ubuntu 的 docker-default AppArmor 会拦截容器连接宿主
   D-Bus（报 `An AppArmor policy prevents this sender...org.freedesktop.DBus`）。
   mcp 服务加 `security_opt: apparmor:unconfined`（容器需访问宿主 BlueZ，信任
   级别等同宿主进程）。非 AppArmor 系统无影响。
6. **零编译构建**：better-sqlite3（唯一原生模块）通过 prebuild-install 下载预编译
   二进制，构建阶段**不需要** python3/make/g++，镜像更快更小。网络受限时可
   通过 build-arg 切换镜像源（见下）：
   - `NPM_REGISTRY`（默认 `https://registry.npmjs.org`）
   - `BETTER_SQLITE3_BINARY_HOST_MIRROR`（默认空 = GitHub Releases；国内可设
     `https://registry.npmmirror.com/-/binary/better-sqlite3`）

## Affected interfaces

- **新增目录**：
  - `deploy/docker-compose.yml`
  - `deploy/mcp/Dockerfile`（多阶段：build → runtime；**零编译**，可配镜像源）
  - `deploy/dashboard/Dockerfile`、`nginx.conf`、`index.html`
- **新增文件**：`.dockerignore`（构建上下文为仓库根，排除 node_modules/dist/data）
- **新增脚本**：`scripts/docker-up.sh`（一键：宿主机准备 + 启动）
- **端口**：mcp `3300:3300`；dashboard `${DASH_PORT:-3330}:80`（占用时可用
  `DASH_PORT=8081 bash scripts/docker-up.sh` 换端口）
- **URL 约定**：
  - MCP 端点：`http://<host>:3300/mcp`
  - Dashboard：`http://<host>:8080/`
  - Skill 下载：`http://<host>:3330/skill/SKILL.md`
- 应用代码（src/）不改动。

## Data layout changes

- SQLite 数据卷 `ble-data` → 容器 `/app/data/ble-simulator.db`
- nginx 静态目录：
  - `/usr/share/nginx/html/index.html`（Dashboard）
  - `/usr/share/nginx/html/skill/SKILL.md`（只读挂载）

## Backward compatibility

- 宿主机原生运行方式（`npm start` / `npm run start:http` / `scripts/ftms-ride.sh`）
  完全不变。
- mcp 容器只是把原 `dist/index.js` 跑在容器里、连宿主 D-Bus，行为一致。
- 新增文件均为纯增量，不影响现有构建/测试。
