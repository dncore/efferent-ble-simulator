# FTMS Indoor Bike Data — 心率字段扩展

## 变更概述

FTMS (Fitness Machine Service) 设备的 Indoor Bike Data characteristic (0x2AD2) 原先只上报速度、踏频、功率、能量和 elapsed time。本次扩展加入心率字段，使 FTMS 设备可以同时上报全部骑行核心指标，无需单独启动 heart_rate 设备类型。

**动机**：用户需要一个脚本启动骑行台模拟，要求功率、心率、踏频全部动态变化。由于 BLE 模拟器同一时间只支持一种设备类型，FTMS 必须自行包含心率上报能力。

## 设计决策

**选择在 FTMS Indoor Bike Data 内嵌心率**，而非运行多个设备实例。

理由：
- BLE 规范允许 Indoor Bike Data 包含心率（bit 10），这是标准做法
- 真实骑行台产品（Wahoo KICKR、Tacx Neo 等）都通过 FTMS 上报心率
- MCP 架构当前不支持多设备并发，单独设备类型会需要额外进程
- 心率复用已有的 `HeartRateSimulator`，零新增模拟逻辑代码

## 接口变更

### FTMSParams — `database.ts`

新增字段：

```typescript
/** 基准心率 (bpm)，0 = 不上报心率 */
baseHeartRate: number;
```

默认值：`120`（典型骑行心率）。设为 `0` 时禁用心率上报，保持原行为。

### FTMSParams MCP Tool Schema — `mcp-server.ts`

新增属性：

```json
"baseHeartRate": { "type": "number", "minimum": 0, "maximum": 220, "description": "基准心率 (bpm)，0=不上报心率" }
```

### summarizeConfig() — `mcp-server.ts`

输出行变更：从 `功率: XW` 扩展为 `功率: XW | 心率: Ybpm 或 关闭`。

## BLE 数据布局变更

### Indoor Bike Data (0x2AD2) Flags

| 变更前 | 变更后 |
|--------|--------|
| `0x0944` | `0x0D44`（心率启用时）/ `0x0944`（心率禁用时） |

新增 bit 10 (0x0400) = Heart Rate present。

### 字段序列（心率启用时）

| Offset | Size | 字段 | 说明 |
|--------|------|------|------|
| 0 | 2 | Flags | `0x0D44` |
| 2 | 2 | Instantaneous Speed | 0.01 km/h uint16 |
| 4 | 2 | Average Cadence | 0.5 rpm uint16 |
| 6 | 2 | Instantaneous Power | 1 W sint16 |
| 8 | 2 | Total Energy | kcal uint16 |
| 10 | 2 | Energy per Hour | 0xFFFF = N/A |
| 12 | 1 | Energy per Minute | 0xFF = N/A |
| **13** | **1** | **Heart Rate** | **1 bpm uint8** |
| 14 | 2 | Elapsed Time | 秒 uint16 |

心率字节插入在 Energy per Minute 和 Elapsed Time 之间，符合 FTMS spec bit 顺序规则。

## 设备实现 — `devices/ftms.ts`

- 引入 `HeartRateSimulator`（来自 `simulator.ts`）
- 新增 `hrSim: HeartRateSimulator | null`，仅在 `baseHeartRate > 0` 时创建
- `buildIndoorBikeData()` 中：
  - running 状态时调用 `hrSim.next()` 推进 tick 并获取当前心率
  - idle/paused 状态时心率冻结在 `hrSim.value`
  - 条性写入心率字节（`hasHr` 控制 flag 和数据偏移）

## 向后兼容

- `baseHeartRate` 默认值 `120` → 所有现有 FTMS 会话自动获得心率上报
- 设为 `0` 可完全禁用，恢复原始 `0x0944` flag 和无心率字节的数据布局
- `hrSim` 为 `null` 时 `buildIndoorBikeData()` 跳过心率字节，行为与变更前完全一致

## 关联文件

- `scripts/ftms-ride.sh` — 启动脚本，使用 `baseHeartRate: 120`
- `docs/design/ftms-heart-rate.md` — 本文档