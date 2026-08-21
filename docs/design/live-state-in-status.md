# ble_status 输出设备实时运行状态（模拟控制状态）

> 设计日期：2026-08-20
> 目的：Dashboard 状态页除「服务状态」外，展示模拟器的实时控制状态
> （骑行中/已暂停/未开始、当前剧本阶段、实时功率/踏频/速度/心率等）。

## What changed

- `BaseDevice` 新增 `getLiveState(): Record<string, unknown>`（默认空对象）；
  FTMS / CyclingPower / CSC / HeartRate 各自覆盖：
  - FTMS：`machineState`（running/paused/idle）、`scenario`、`phase`
    （ride_script 当前阶段）、`grade`、`power`、`cadence`、`speedKph`、
    `heartRate`、`elapsedSeconds`
  - CyclingPower / CSC：`power`、`cadence`、`speedKph`（引擎存在时）
  - HeartRate：`heartRate`
- `BleController.getLiveState()` 透传 `device?.getLiveState()`
- `ble_status` 输出新增「设备运行状态:」段落（中文格式化）
- Dashboard 状态页新增「模拟控制状态」卡片，解析并渲染该段落

## Key design decisions

1. 实时状态从设备对象直接读取（`device.getLiveState()`），不经过 D-Bus——
   BLE 层本就由设备对象驱动，读内部状态最直接、无额外延迟。
2. 输出格式沿用 `ble_status` 的纯文本段落约定（`设备运行状态:` 之后缩进行），
   与「当前配置:」段落一致，Dashboard 解析方式相同、向后兼容。
3. 各设备类型只暴露自己有意义的字段；无引擎/无心率时不输出对应字段，
   `getLiveState()` 返回空对象时省略整个段落。

## Affected interfaces

- `ble_status` 工具输出：新增「设备运行状态:」段落（纯增量，旧字段不变）
- `BaseDevice` 新增方法 `getLiveState()`；四个设备类覆盖
- Dashboard：状态页新增「模拟控制状态」卡片

## Data layout changes

`ble_status` 输出示例：

```
设备运行状态:
  运行状态: 骑行中 | 场景: ride_script | 阶段: 爬坡
  坡度: 5%
  功率: 260W | 踏频: 75rpm | 速度: 14.2km/h | 心率: 118bpm
  已骑行: 6min
```

- `machineState` 映射：running→骑行中、paused→已暂停、idle→未开始
- `phase` 映射：start→起步、cruise→巡航、climb→爬坡、sprint→冲刺、
  coast→滑行、stop→停车（非 ride_script 场景无此字段）

## Backward compatibility

- `ble_status` 原有字段与「当前配置:」段落完全不变，仅追加新段落
- 未运行模拟器时无设备对象 → 无「设备运行状态」段落，Dashboard 显示
  「模拟器未运行（无实时状态）」
- 静态模式（无动态模拟）下引擎为空 → 只输出 machineState/elapsedSeconds
  （FTMS）或空段落
