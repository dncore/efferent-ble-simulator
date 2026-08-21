#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# 部署时把 SKILL.md 模板中的占位符替换为实际部署机地址
#   <host>      → ${SKILL_HOST_IP}   （部署机 LAN IP，docker-up.sh 自动探测）
#   :3300/mcp   → ${SKILL_MCP_PORT}  （MCP 端口）
#   :3330/      → ${SKILL_DASH_PORT} （Dashboard 端口）
# 未设置 SKILL_HOST_IP 时原样提供模板（占位符保持可读）。
# ────────────────────────────────────────────────────────────────────────────
set -e

TMPL=/usr/share/nginx/html/skill/SKILL.md.tmpl
OUT=/usr/share/nginx/html/skill/SKILL.md

if [ -f "$TMPL" ]; then
  if [ -n "${SKILL_HOST_IP:-}" ]; then
    sed -e "s|http://<host>:3300/mcp|http://${SKILL_HOST_IP}:${SKILL_MCP_PORT:-3300}/mcp|g" \
        -e "s|http://<host>:3330/|http://${SKILL_HOST_IP}:${SKILL_DASH_PORT:-3330}/|g" \
        -e "s|http://<device-ip>:3300/mcp|http://${SKILL_HOST_IP}:${SKILL_MCP_PORT:-3300}/mcp|g" \
        "$TMPL" > "$OUT"
    echo "[skill] SKILL.md 已替换为部署地址: http://${SKILL_HOST_IP}:${SKILL_DASH_PORT:-3330}/"
  else
    cp "$TMPL" "$OUT"
    echo "[skill] SKILL_HOST_IP 未设置，Skill 保持通用占位符"
  fi
fi
