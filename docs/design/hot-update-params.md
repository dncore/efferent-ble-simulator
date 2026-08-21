# 模拟参数热更新（ble_configure 原地生效）

> 设计日期：2026-08-20
> 目的：通过 Dashboard / MCP 修改模拟参数时，保持中心设备（手机）的 BLE
> 连接，下一条 notify 即生效，而不是重建 GATT 导致断连。

## What changed

- `BaseDevice.applyConfig(config)` 新增：原地热更新设备参数（默认无操作）
- 四个设备类覆盖 `applyConfig`：
  - FTMS：基础参数（速度/踏频/功率/阻力/坡度）+ 心率基准 + 引擎/场景热更新
  - CyclingPower / CSC：基础值 + 引擎/场景热更新
  - HeartRate：心率基准
- `BaseDevice.config` 由 `readonly` 改为可写，`applyConfig` 同步更新设备配置
  （否则 getLiveState 等读到旧配置）
- `BleController.updateParams(cfg)`：同设备类型守卫 + 原地应用 + 更新 currentConfig
- `ble_configure`：运行中且同设备类型 → 热更新（**保持连接**）；设备类型变化
  → 仍走完整重启
- `SimulatorDatabase.updateSessionConfig(id, cfg)`：热更新当前会话的配置
  （不改变 stopped_at，会话保持）

## Motivation

原实现：运行中调用 ble_configure 会 `stopSession + createSession +
controller.restart()`，restart 内部 `stop()` 执行 `bus.disconnect()` +
注销 GATT 应用 → **手机 BLE 连接被断开**，只能收到旧缓存数据，参数修改
永远"不实时"。

## Key design decisions

1. **同设备类型 → 原地热更新**：参数级变更不重建 GATT/广播，中心设备
   连接保持，notify 计时器持续运行，下一拍（默认 500ms）即推送新值。
2. **设备类型变化 → 完整重启**：服务结构（GATT 特征集）不同，无法原地
   替换，仍走 stop+start（手机需重新连接，序列号变化强制重新发现）。
3. **引擎场景热更新**：`CyclingSimulationEngine.updateConfig(partial)`
   已支持（含 scenario 重初始化），applyConfig 直接复用；引擎基准功率
   通过 `updateParams → updateBasePower` 同步。
4. **配置一致性**：`applyConfig` 同步更新 `this.config`，保证
   `getLiveState`/后续读取与引擎实际状态一致。

## Affected interfaces

- `ble_configure` 工具：运行中 + 同设备类型时返回「配置已热更新（连接保持，
  实时生效）」；设备类型变化返回「配置已更新并重启」
- `BleController` 新增 `updateParams(cfg)`；`SimulatorDatabase` 新增
  `updateSessionConfig(id, cfg)`
- `BaseDevice` 新增 `applyConfig(config)`；`config` 字段去掉 readonly

## Data layout changes

- 会话记录：热更新时更新当前 session 的 `config_json`，`stopped_at` 不变
- 无新增 BLE 数据字段

## Backward compatibility

- 未运行 / 设备类型变化时行为与原版一致（完整重启）
- 热更新仅限参数级变更；`notifyIntervalMs`、设备名称/序列号等结构性参数
  在热更新中不生效（文档说明），此类变更请重启
- `getLiveState()` 语义不变，仍读引擎/设备当前状态
