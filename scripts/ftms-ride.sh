#!/usr/bin/env bash
#
# 启动 BLE 骑行台模拟器（HTTP MCP 模式）
#
# 模拟场景：骑行台设备，骑行剧本（起步→巡航→爬坡→冲刺→下坡滑行→停车）
# 功率/坡度/踏频/速度随剧本阶段自动变化，无需 App 参与，启动即自动开始骑行
#
# 用法：
#   bash scripts/ftms-ride.sh           # 启动模拟
#   bash scripts/ftms-ride.sh stop      # 停止模拟
#   bash scripts/ftms-ride.sh status    # 查看状态
#   bash scripts/ftms-ride.sh restart   # 重启模拟
#

set -euo pipefail

MCP_PORT="${MCP_PORT:-3300}"
MCP_HOST="${MCP_HOST:-0.0.0.0}"
MCP_URL="http://127.0.0.1:${MCP_PORT}/mcp"

# ─── MCP JSON-RPC helpers ─────────────────────────────────────────────────────

call_mcp() {
  local method="$1"
  local params="$2"

  curl --noproxy '*' -s -X POST "${MCP_URL}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$(jq -n \
      --arg method "$method" \
      --argjson params "$params" \
      '{jsonrpc:"2.0", id: 1, method: $method, params: $params}')"
}

parse_result() {
  local raw="$1"
  local json
  json="$(grep '^data:' <<< "$raw" | sed 's/^data: *//' | head -1)"
  jq -r '.result.content[0].text // .error.message // "Unexpected response: " + .' <<< "$json"
}

# ─── Actions ────────────────────────────────────────────────────────────────────

start_simulator() {
  echo "=> 启动 BLE Simulator MCP 服务（HTTP 模式）..."

  # 检查是否已有 HTTP 服务在运行
  if curl --noproxy '*' -s "${MCP_URL}" >/dev/null 2>&1; then
    echo "   MCP 服务已在运行 (port ${MCP_PORT})"
  else
    # 启动 HTTP 模式后台服务
    MCP_TRANSPORT=http node dist/index.js &
    SIM_PID=$!
    echo "   MCP 服务已启动 (PID: ${SIM_PID}, port: ${MCP_PORT})"

    # 等待服务就绪
    for i in $(seq 1 15); do
      if curl --noproxy '*' -s "${MCP_URL}" >/dev/null 2>&1; then
        echo "   服务就绪！"
        break
      fi
      sleep 1
    done

    if ! curl --noproxy '*' -s "${MCP_URL}" >/dev/null 2>&1; then
      echo "   错误: MCP 服务未能就绪，请检查日志"
      exit 1
    fi
  fi

  # 先尝试停止已有模拟（如果之前有残留会话）
  call_mcp "tools/call" '{"name":"ble_stop","arguments":{}}' >/dev/null 2>&1 || true

  echo "=> 启动 FTMS 骑行台模拟（动态模式）..."

  # FTMS 设备 + 动态模拟 + 心率
  # 功率基准 150W, 踏频 80rpm, 心率 120bpm
  # freeride 场景：功率每 60-180 tick 随机偏移 ±20%
  # proportional 踏频耦合：功率↑时踏频微↑
  # 通知间隔 500ms
  local start_params
  start_params=$(jq -n '{
    "name": "ble_start",
    "arguments": {
      "deviceType": "ftms",
      "deviceInfo": {
        "deviceName": "OPEN_RIDE",
        "manufacturer": "Open Ride",
        "modelNumber": "OPEN_RIDE",
        "firmwareRevision": "1.0.0",
        "hardwareRevision": "1.0",
        "softwareRevision": "1.0.0"
      },
      "ftms": {
        "speedKph": 25,
        "cadenceRpm": 80,
        "powerWatts": 150,
        "baseHeartRate": 120,
        "notifyIntervalMs": 500,
        "resistanceLevel": 10,
        "grade": 0,
        "minResistance": 1,
        "maxResistance": 100,
        "minPower": 0,
        "maxPower": 4000,
        "simulation": {
          "enabled": true,
          "riderWeightKg": 75,
          "bikeWeightKg": 8,
          "crr": 0.004,
          "cdA": 0.35,
          "scenario": {
            "type": "ride_script",
            "repeat": true,
            "phases": [
              { "type": "start",  "durationSeconds": 30,  "targetPower": 60,  "grade": 0,  "cadence": 60 },
              { "type": "cruise", "durationSeconds": 90,  "targetPower": 180, "grade": 0,  "cadence": 85 },
              { "type": "climb",  "durationSeconds": 60,  "targetPower": 260, "grade": 5,  "cadence": 75 },
              { "type": "sprint", "durationSeconds": 20,  "targetPower": 400, "grade": 0,  "cadence": 100 },
              { "type": "coast",  "durationSeconds": 40,  "targetPower": 80,  "grade": -2, "cadence": 55 },
              { "type": "stop",   "durationSeconds": 20,  "targetPower": 0,   "grade": 0 }
            ]
          },
          "autoStart": true,
          "fatigueFactor": 0.0005,
          "cadenceCoupling": "proportional",
          "microPauseProbability": 0.008
        }
      },
      "notes": "骑行台模拟 — 150W freeride 动态模式, 心率120bpm"
    }
  }')

  local result
  result="$(call_mcp "tools/call" "$start_params")"
  echo ""
  parse_result "$result"
  echo ""

  echo "=> 骑行台模拟已就绪！（ride_script 剧本，自动开始骑行）"
  echo ""
  echo "   剧本: 起步30s→巡航90s→爬坡60s(5%)→冲刺20s→下坡滑行40s→停车20s"
  echo "   功率/坡度/踏频/速度 随剧本阶段自动变化（循环播放）"
  echo "   心率:   120bpm ± 动态波动 (趋势 + 噪声)"
  echo ""
  echo "   配对方式: 在骑行 App 搜索设备名（见上方 MCP 输出）"
  echo ""
  echo "   停止: bash scripts/ftms-ride.sh stop"
  echo "   状态: bash scripts/ftms-ride.sh status"
}

stop_simulator() {
  echo "=> 停止 BLE 模拟..."

  local result
  result="$(call_mcp "tools/call" '{"name":"ble_stop","arguments":{}}')"
  parse_result "$result"

  echo ""
  echo "=> 模拟已停止。"
}

show_status() {
  echo "=> 查询 BLE 模拟状态..."

  local result
  result="$(call_mcp "tools/call" '{"name":"ble_status","arguments":{}}')"
  echo ""
  parse_result "$result"
}

restart_simulator() {
  echo "=> 重启 BLE 模拟..."

  local restart_params
  restart_params=$(jq -n '{
    "name": "ble_restart",
    "arguments": {
      "deviceType": "ftms",
      "ftms": {
        "powerWatts": 150,
        "cadenceRpm": 80,
        "baseHeartRate": 120,
        "notifyIntervalMs": 500,
        "simulation": {
          "enabled": true,
          "scenario": {
            "type": "ride_script"
          }
        }
      },
      "notes": "重启骑行台模拟"
    }
  }')

  local result
  result="$(call_mcp "tools/call" "$restart_params")"
  echo ""
  parse_result "$result"
  echo ""
  echo "=> 模拟已重启。"
}

# ─── Main ──────────────────────────────────────────────────────────────────────

ACTION="${1:-start}"

case "$ACTION" in
  start)   start_simulator ;;
  stop)    stop_simulator ;;
  status)  show_status ;;
  restart) restart_simulator ;;
  *)
    echo "用法: bash scripts/ftms-ride.sh [start|stop|status|restart]"
    echo ""
    echo "  start   — 启动骑行台模拟（默认）"
    echo "  stop    — 停止模拟"
    echo "  status  — 查询当前状态"
    echo "  restart — 重启模拟"
    exit 1
    ;;
esac