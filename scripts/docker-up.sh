#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BLE Simulator — Docker Compose 一键部署
#
#   bash scripts/docker-up.sh          # 宿主机准备 + 构建并启动（默认）
#   bash scripts/docker-up.sh down     # 停止并移除容器（数据卷保留）
#   bash scripts/docker-up.sh status   # 查看服务状态
#   bash scripts/docker-up.sh logs     # 跟踪 mcp 服务日志
#
# 架构说明：BLE 外设必须通过宿主机 BlueZ D-Bus，容器挂载宿主机 D-Bus socket。
# 首次部署需要 sudo 运行宿主机准备（复用 scripts/setup.sh：安装 BlueZ、
# 写入 /etc/dbus-1/system.d/ble-simulator.conf 策略、启动 bluetoothd）。
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
error()   { echo -e "${RED}[deploy]${NC} $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
COMPOSE_FILE="${PROJECT_DIR}/deploy/docker-compose.yml"
DASH_PORT="${DASH_PORT:-3330}"
MCP_PORT="${MCP_PORT:-3300}"
# 部署机 LAN IP（供 Skill 文档替换占位符）；可显式 SKILL_HOST_IP 覆盖
if [[ -z "${SKILL_HOST_IP:-}" ]]; then
  SKILL_HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  export SKILL_HOST_IP
fi

# ── 前置检查 ──────────────────────────────────────────────────────────────────
require_docker() {
  if ! command -v docker &>/dev/null; then
    error "未找到 docker。请先安装：https://docs.docker.com/engine/install/"
    exit 1
  fi
  if ! docker compose version &>/dev/null; then
    error "未找到 docker compose 插件（需要 Docker Compose v2+）。"
    exit 1
  fi
  if ! docker info &>/dev/null; then
    error "Docker daemon 未运行。请先启动：sudo systemctl start docker"
    exit 1
  fi
}

# ── 宿主机准备（BlueZ + D-Bus 策略）────────────────────────────────────────────
host_prepare() {
  local need_setup=false
  if ! command -v bluetoothctl &>/dev/null; then
    warn "未检测到 BlueZ，需要运行宿主机准备…"
    need_setup=true
  elif [[ ! -f /etc/dbus-1/system.d/ble-simulator.conf ]]; then
    warn "缺少 D-Bus 策略 /etc/dbus-1/system.d/ble-simulator.conf，需要运行宿主机准备…"
    need_setup=true
  elif ! systemctl is-active --quiet bluetooth 2>/dev/null; then
    warn "bluetoothd 未运行，需要运行宿主机准备…"
    need_setup=true
  fi

  if [[ "$need_setup" == true ]]; then
    info "运行 sudo bash scripts/setup.sh（安装/启动 BlueZ、写入 D-Bus 策略）…"
    sudo bash "${SCRIPT_DIR}/setup.sh"
    success "宿主机准备完成"
  else
    success "宿主机已就绪（BlueZ + D-Bus 策略存在）"
  fi

  # BlueZ 版本检查：5.86 有广告注册 bug，需要 ≥ 5.87
  local ver
  ver=$(bluetoothd --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)
  if [[ -n "$ver" ]]; then
    if [[ "$(echo "$ver" | awk -F. '{print $1*100+$2}')" -lt 587 ]]; then
      warn "BlueZ 版本 ${ver} < 5.87（5.86 广告注册有 bug）。建议升级："
      warn "   Arch:   sudo pacman -S bluez && sudo systemctl restart bluetooth"
      warn "   Debian: sudo apt install bluez   （升级后重启 bluetooth 服务）"
    else
      success "BlueZ ${ver}（≥ 5.87）"
    fi
  else
    warn "无法读取 BlueZ 版本，请确认 bluetoothd 已启动。"
  fi
}

# ── 启动 ──────────────────────────────────────────────────────────────────────
start() {
  require_docker
  host_prepare

  info "构建并启动 docker compose 服务…"
  cd "${PROJECT_DIR}"
  docker compose -f "${COMPOSE_FILE}" up -d --build

  info "等待 mcp 服务健康（最多 90s）…"
  for i in $(seq 1 30); do
    if docker compose -f "${COMPOSE_FILE}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "^mcp healthy"; then
      break
    fi
    sleep 3
  done

  if ! docker compose -f "${COMPOSE_FILE}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "^mcp healthy"; then
    warn "mcp 服务未在预期时间内健康，请检查：docker compose -f deploy/docker-compose.yml logs mcp"
  fi

  echo ""
  success "部署完成！"
  echo ""
  echo "   MCP 端点:      http://<本机IP>:${MCP_PORT}/mcp"
  echo "   Dashboard:     http://<本机IP>:${DASH_PORT}/"
  echo "   Skill 下载:    http://<本机IP>:${DASH_PORT}/skill/SKILL.md"
  echo ""
  echo "   停止:  bash scripts/docker-up.sh down"
  echo "   状态:  bash scripts/docker-up.sh status"
  echo "   日志:  bash scripts/docker-up.sh logs"
}

# ── 子命令 ────────────────────────────────────────────────────────────────────
case "${1:-start}" in
  start)   start ;;
  down)
    require_docker
    docker compose -f "${COMPOSE_FILE}" down
    success "已停止并移除容器（数据卷 ble-data 保留）。彻底清除：docker volume rm ble-data"
    ;;
  status)
    require_docker
    docker compose -f "${COMPOSE_FILE}" ps
    ;;
  logs)
    require_docker
    docker compose -f "${COMPOSE_FILE}" logs -f mcp
    ;;
  *)
    echo "用法: bash scripts/docker-up.sh [start|down|status|logs]"
    exit 1
    ;;
esac
