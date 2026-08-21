#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Efferent BLE Simulator — 同步发布快照到 GitHub
#
# 本地仓库保留完整开发历史；GitHub 仓库保持"干净的初始快照"形态
# （单提交、无历史包袱、提交者匿名邮箱）。
# 本脚本将当前工作树打包 → 全新单提交 → 强推 GitHub main。
#
# 用法：
#   bash scripts/sync-github.sh [commit-message]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

GITHUB_REPO="git@github.com:dncore/efferent-ble-simulator.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

# 默认提交信息（可用参数覆盖）
COMMIT_MSG="${1:-feat: Efferent BLE Simulator v$(grep -oP '\"version\": \"\K[^\"]+' "${PROJECT_DIR}/package.json") — Turn Linux into a Bluetooth peripheral}"
COMMIT_MSG="${COMMIT_MSG:-feat: Efferent BLE Simulator — Turn Linux into a Bluetooth peripheral}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "[sync-github] 打包工作树（排除 .git/node_modules/dist/data 等）..."
cd "${PROJECT_DIR}"
tar czf "${TMP}/src.tar.gz" \
  --exclude='.git' --exclude='node_modules' --exclude='dist' \
  --exclude='data' --exclude='.claude' --exclude='.remember' \
  --exclude='.vscode' --exclude='*.db' .
mkdir -p "${TMP}/snapshot"
tar xzf "${TMP}/src.tar.gz" -C "${TMP}/snapshot"
cd "${TMP}/snapshot"

echo "[sync-github] 创建干净单提交..."
git init -q -b main
git config user.name "Dean"
git config user.email "39996019+dncore@users.noreply.github.com"
git add -A
git commit -q -m "${COMMIT_MSG}"

echo "[sync-github] 强推 GitHub main..."
git remote add origin "${GITHUB_REPO}"
git push -f origin main

echo "[sync-github] 完成 ✓"
