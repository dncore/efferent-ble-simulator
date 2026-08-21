# 骑行剧本场景（ride_script）

> 设计日期：2026-08-19
> 关联功能：FTMS 智能骑行台模拟 —— 自动模拟完整骑行过程

## What changed

新增 `ride_script` 骑行场景：模拟一次完整骑行，按剧本阶段自动切换动作
（起步 → 巡航 → 爬坡 → 冲刺 → 下坡滑行 → 停车），每个阶段自动调整功率、
坡度、踏频，并通过物理模型计算速度。**无需外部骑行 App 参与**——启动后
自动进入 `running` 状态并开始推送动态数据。

配套新增 `simulation.autoStart` 选项，让骑行台在启动时自动进入骑行状态。

## Motivation

现有场景（steady / intervals / warmup_main_cooldown / freeride）只模拟
功率/踏频的统计波动，且 FTMS 设备默认处于 `idle` 状态——必须由外部 App
连接后发送 FTMS 控制点 Start 命令才会开始推送动态数据。用户希望不依赖
App，直接看到骑行台模拟完整的骑行动作（起步、爬坡、冲刺、滑行、停车）。

## Key design decisions

1. **剧本阶段 = 显式的动作序列**：每个阶段由 `RidePhase` 描述
   （type / durationSeconds / targetPower / grade / cadence?）。
   相比给 freeride 加"事件"，显式剧本更可预测、可演示、可被 MCP 精确控制。

2. **坡度由剧本驱动**：原设计里坡度（grade）由设备配置或控制点
   `Set Indoor Bike Simulation Parameters`（0x11）提供，作为 `next(grade)`
   的入参。骑行剧本需要自行控制坡度（爬坡 +5%、下坡 -2%），因此引擎内部
   维护 `scriptGrade`，在 `next()` 中优先使用剧本坡度计算速度，外部传入的
   grade 仅作为非剧本场景的回退值。

3. **stop 阶段强制归零**：剧本 `stop` 阶段把功率基准与踏频基准归零，并在
   `next()` 中直接返回 cadence=0，从而速度按物理模型归零——模拟真实停车，
   而不是让模拟器继续输出漂移的小数值。

4. **ride_script 默认自动开始**：`autoStart` 默认值由场景类型决定——
   `ride_script` 隐含自动开始（`autoStart ?? (type === 'ride_script')`），
   其他场景需显式 `autoStart: true`。保持向后兼容：不传时其他场景行为不变。

5. **阶段切换用 tick 计数**：沿用引擎统一的 tick 驱动（`ticksPerSecond`），
   阶段时长 = `durationSeconds × ticksPerSecond`。支持 `repeat: true`
   循环播放；不循环则停留在最后一个阶段（通常为 stop）。

## Affected interfaces

- **`RidingScenario`**（`src/database.ts`）新增变体：
  `{ type: 'ride_script'; phases?: RidePhase[]; repeat?: boolean }`
- **`RidePhase` / `RidePhaseType`**：新增类型。`RidePhaseType` =
  `'start' | 'cruise' | 'climb' | 'sprint' | 'coast' | 'stop'`
- **`DEFAULT_RIDE_SCRIPT_PHASES`**：默认剧本常量（见下节）。
- **`CyclingSimulationConfig`** 新增可选字段 `autoStart?: boolean`。
- **`CyclingSimulationEngine`** 新增：
  - `advanceRideScript()` / `enterRidePhase()` 状态机逻辑；
  - `next()` 内部优先用剧本坡度；
  - 只读 getter `currentGrade: number | null`、`currentPhaseType: RidePhaseType | null`。
- **MCP 工具 schema**（`SIMULATION_SCHEMA`）：`scenario.type` 枚举增加
  `ride_script`；新增 `scenario.phases[]`、`scenario.repeat`、`autoStart`
  字段描述。handler 走 `buildConfigFromInput` → `mergeConfig` 全量透传，
  无需改动 handler。
- **`scripts/ftms-ride.sh`**：start/restart 改用 `ride_script` 剧本。
- **BLE 侧无新特性**：仍复用 0x1826 服务、0x2AD2 Indoor Bike Data、
  0x2AD9 Control Point、0x2ADA Machine Status。自动开始仅改变
  Machine Status 初始值与数据推送状态。

## Data layout changes

- **剧本阶段数据**（MCP 参数 / 配置 JSON）：
  ```json
  "scenario": {
    "type": "ride_script",
    "repeat": true,
    "phases": [
      { "type": "start",  "durationSeconds": 30, "targetPower": 60,  "grade": 0,  "cadence": 60 },
      { "type": "cruise", "durationSeconds": 90, "targetPower": 180, "grade": 0,  "cadence": 85 },
      { "type": "climb",  "durationSeconds": 60, "targetPower": 260, "grade": 5,  "cadence": 75 },
      { "type": "sprint", "durationSeconds": 20, "targetPower": 400, "grade": 0,  "cadence": 100 },
      { "type": "coast",  "durationSeconds": 40, "targetPower": 80,  "grade": -2, "cadence": 55 },
      { "type": "stop",   "durationSeconds": 20, "targetPower": 0,   "grade": 0 }
    ]
  }
  ```
- **默认剧本** `DEFAULT_RIDE_SCRIPT_PHASES`：起步 30s/60W → 巡航 120s/180W →
  爬坡 90s/260W@5% → 冲刺 30s/400W → 下坡滑行 45s/80W@-2% → 停车 30s/0W。
- **`autoStart`**：布尔，可选。`true` → FTMS 构造后直接 `machineState='running'`，
  Machine Status（0x2ADA）初始值置为 `0x04`（Started）而非 `0x01`（Reset）。

## Backward compatibility

- 所有新增字段可选：`phases?`、`repeat?`、`autoStart?` 缺省不影响旧配置。
- 未设置 `ride_script` 的旧配置行为完全不变（仍是静态/既有动态场景）。
- `mergeSimulation` 对 `scenario` 的浅合并保持不变；`ride_script` 未提供
  `phases` 时引擎回退到 `DEFAULT_RIDE_SCRIPT_PHASES`。
- `next(grade, wind)` 签名不变；非剧本场景的坡度仍由外部传入 / 控制点驱动，
  `scriptGrade` 为 `null` 时行为与旧版一致。
- cycling_power / csc 设备同样复用引擎，若配置 ride_script 也会按剧本波动
  （它们无坡度/无 autoStart 语义，不受影响）。
