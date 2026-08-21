# 稳定序列号模式（SIM_SERIAL_STABLE）

> 设计日期：2026-08-20
> 目的：同设备类型会话 stop→start 后，让中心设备（手机）无需"忘记设备"
> 即可无缝重连；设备类型切换仍强制重新发现。

## What changed

- `ble-controller.ts` 的 `buildBroadcastDeviceInfo()` 支持两种序列号策略：
  - **默认**（无环境变量）：`<serial>-S<sessionId>` —— 每次会话变化，强制
    重新发现（旧行为，向后兼容）
  - **稳定模式**（`SIM_SERIAL_STABLE=1`）：`<serial>-<TYPE>` —— 同设备
    类型会话序列号稳定，类型切换仍变化
- `docker-compose.yml`：mcp 服务透传 `SIM_SERIAL_STABLE` 环境变量
- `src/index.ts` 头注释、README、SKILL.md 记录该变量

## Motivation

旧设计每次会话给序列号加 `-S<id>` 后缀（防止配置变更后 App 用旧 GATT
缓存）。但同类型参数变更已走**热更新**（不重启、不改序列号），stop→start
的同类型重启 GATT 结构完全一致——序列号变化反而导致严格校验序列号的骑行
App（Garmin/Polar 等）要求用户"忘记设备"重新配对，体验差且无实际收益。

## Key design decisions

1. **稳定但带类型标签**：`<serial>-FTMS` / `-CP` / `-CSC` / `-HR`。
   同类型重启序列号一致 → App 视为同一设备，无缝重连；设备类型切换
   （GATT 结构不同）序列号变化 → 强制重新发现，避免旧缓存错配。
2. **默认关闭**（opt-in）：保持向后兼容，现有部署行为不变；需要
   无缝重连体验的部署显式设置 `SIM_SERIAL_STABLE=1`。

## Affected interfaces

- 广播序列号格式（GATT Device Information / 广播名相关 App 可见）：
  - 默认：`C01002-S24` → `C01002-S25`
  - 稳定：`C01002-FTMS`（同类型重启不变；类型切换 → `C01002-CP`）
- 环境变量 `SIM_SERIAL_STABLE=1`；compose 透传 `${SIM_SERIAL_STABLE:-}`

## Data layout changes

- 无数据库/协议变化；仅广播/Device Info 的 serialNumber 字符串格式。

## Backward compatibility

- 未设置 `SIM_SERIAL_STABLE` 时行为与旧版完全一致（每次会话新后缀）。
- 稳定模式下，同类型 restart 后手机端 GATT 缓存依然有效（结构一致）。
