<p align="center">
  <img src="assets/efferent-ble-simulator.svg" width="128" height="128" alt="Efferent BLE Simulator">
</p>

<h1 align="center">Efferent BLE Simulator</h1>

<p align="center"><strong>Efferent — Turn Linux into a Bluetooth peripheral.</strong></p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/version-1.0.0-green" alt="version">
  <img src="https://img.shields.io/badge/platform-Linux%20%2F%20BlueZ-lightgrey" alt="platform">
</p>

Efferent 在真实蓝牙射频（Linux BlueZ）上模拟 BLE 外设：**FTMS 智能骑行台**、**功率计**、**速度/踏频计**、**心率计**。通过 **MCP 服务**（stdio 或 HTTP），AI Agent 与内置 Web Dashboard 可以像控制真实骑行台一样启动、配置、监控模拟。

---

## 功能特性

- **4 种设备类型**（真实 BLE 广播）：FTMS 骑行台 (0x1826)、功率计 (0x1818)、速度/踏频 (0x1816)、心率计 (0x180D)
- **完整 FTMS 控制点**：Request Control / Start / Stop / Reset / Set Target Power / Set Resistance / Set Indoor Bike Simulation Params
- **动态模拟**：拟真的功率/踏频波动 + 物理速度模型（体重/坡度/Crr/CdA），5 种骑行场景，含脚本化的 **ride_script 骑行剧本**
- **参数热更新**：运行中修改参数——手机连接保持，下一条 notify 即生效（无需重新配对）
- **命名配置预设**：保存/载入/重命名/删除（上限 20 条），MCP 与 Dashboard 共享
- **17 个 MCP 工具**：控制、配置、配置预设、交互规则、会话、日志、实时状态、版本
- **Web Dashboard**（React + shadcn/ui）：状态、参数表单、一键骑行动作模板、交互规则、会话/配置管理、实时日志侧面板
- **Docker Compose 一键部署**（MCP + Dashboard + Skill HTTP 下载），健康检查长期运行
- **版本化**：MCP `serverInfo.version` + `ble_get_version` 让 Agent 感知更新

---


## 运行环境

| 要求 | 说明 |
|---|---|
| 操作系统 | **仅 Linux** — 模拟器通过 D-Bus 驱动宿主机的 **BlueZ** |
| BlueZ | ≥ 5.87（5.86 存在广告注册 bug）|
| 硬件 | 需要 **BLE 适配器**（内置或 USB 蓝牙）才能真正广播 |
| D-Bus 策略 | `/etc/dbus-1/system.d/ble-simulator.conf`（由 `npm run setup` 安装）— 非 root 注册 GATT 必需 |
| Docker | mcp 容器**挂载宿主机 D-Bus socket**；BLE 射频始终留在宿主机 |
| 不支持 | macOS / Windows 原生运行（需不同 BLE 协议栈）；无 BLE 适配器时 MCP 服务可运行但无法发射 |

## 架构

```
┌──────────────┐   MCP 协议       ┌───────────────────────────┐
│ AI Agent /   │ ◄───────────────► │ MCP Server (HTTP :3300)   │
│ MCP Client   │  stdio / :3300    │ Web Dashboard (:3330)     │
│ (Claude、    │                   └────────────┬──────────────┘
│  Codex、pi)  │                                │ BlueZ D-Bus（系统总线）
└──────────────┘                                ▼
                                     ┌───────────────────────────┐
                                     │ 宿主机 Linux BlueZ        │
                                     │ bluetoothd + BLE 适配器   │
                                     │ (D-Bus 策略, ≥ 5.87)      │
                                     └────────────┬──────────────┘
                                                  │ HCI / 射频
                                                  ▼
                                     ┌───────────────────────────┐
                                     │ BLE 广播 + GATT           │
                                     │ FTMS / 功率 / 踏频 / 心率 │
                                     └────────────┬──────────────┘
                                                  │
                                     ┌────────────▼──────────────┐
                                     │ 手机 / 骑行 App            │
                                     │ (Zwift、Garmin、行者...)   │
                                     └───────────────────────────┘
```

## 设备类型

| 类型 | BLE 服务 | 特征 |
|---|---|---|
| **FTMS** 智能骑行台 | 0x1826 | FM Feature、Indoor Bike Data(notify)、Control Point(write/indicate)、Status、阻力/功率范围 |
| **功率计** | 0x1818 | 功率/踏频测量、轮圈与曲柄数据 |
| **速度/踏频 (CSC)** | 0x1816 | 轮圈与曲柄圈数计数 |
| **心率计** | 0x180D | 心率测量、佩戴位置、电量 |

---

## 快速开始

### 前置要求

- Linux + **BlueZ ≥ 5.87**（bluetoothd）+ BLE 适配器
  > BlueZ 5.86 存在广告注册 bug；在严格校验内核上所有 `RegisterAdvertisement` 都会失败。先升级：`sudo pacman -S bluez && sudo systemctl restart bluetooth`（Arch）/ `sudo apt install bluez`（Debian）。
- Node.js ≥ 18

### 1. 原生安装

```bash
npm install
npm run setup     # sudo — 写入 D-Bus 策略、启用 bluetoothd、验证 GATT
npm run build
npm run start:http   # HTTP 模式 :3300（或 npm start 用 stdio）
```

`npm run setup` 写入 `/etc/dbus-1/system.d/ble-simulator.conf`——**必需**（否则非 root 无法注册 GATT，设备能广播但连不上）。

### 2. Docker Compose（推荐服务器部署）

```bash
bash scripts/docker-up.sh     # 宿主机准备（sudo，首次）+ 构建 + 启动
```

| URL | 用途 |
|---|---|
| `http://<host>:3300/mcp` | MCP 端点 |
| `http://<host>:3330/` | Web Dashboard |
| `http://<host>:3330/skill/SKILL.md` | 操作 Skill（供 Agent）|
| `http://<host>:3330/help` | Dashboard 使用说明页 |

零编译构建（better-sqlite3 预编译二进制）；网络受限时用镜像源：
```bash
NPM_REGISTRY=https://registry.npmmirror.com \
BETTER_SQLITE3_BINARY_HOST_MIRROR=https://registry.npmmirror.com/-/binary/better-sqlite3 \
bash scripts/docker-up.sh
```

管理：`bash scripts/docker-up.sh status|logs|down`

---

## MCP 工具（17 个）

| 工具 | 用途 |
|---|---|
| `ble_start` / `ble_stop` / `ble_restart` | 启动 / 停止 / 重启模拟 |
| `ble_status` | 控制器状态 + 当前配置 + **设备实时状态**（阶段/功率/踏频/心率）|
| `ble_configure` | 更新配置——运行中同设备类型为**原地热更新** |
| `ble_get_config` | 当前/最近配置 JSON（表单回填）|
| `ble_save_config` | 保存当前参数为命名配置（**上限 20**）|
| `ble_list_configs` / `ble_get_config_detail` | 列出 / 查看已保存配置 |
| `ble_rename_config` / `ble_delete_config` | 重命名 / 删除配置 |
| `ble_set_interaction` / `ble_clear_interactions` | 自定义 BLE 写入响应规则 |
| `ble_list_sessions` / `ble_get_session` | 会话历史 / 详情 |
| `ble_get_logs` | 持久化通信日志（连接/写入/推送/错误）|
| `ble_get_version` | MCP 与 Skill 版本、变更摘要、Skill 下载地址（更新检测）|

### 示例

```json
{
  "method": "tools/call",
  "params": {
    "name": "ble_start",
    "arguments": {
      "deviceType": "ftms",
      "ftms": { "simulation": { "enabled": true, "scenario": { "type": "ride_script" } } }
    }
  }
}
```

---

## 动态模拟

在 FTMS / 功率计 / 速度踏频 的 `simulation` 子对象开启：

```json
"simulation": {
  "enabled": true,
  "riderWeightKg": 75, "bikeWeightKg": 8, "crr": 0.004, "cdA": 0.35,
  "fatigueFactor": 0.0005, "cadenceCoupling": "proportional", "microPauseProbability": 0.008,
  "autoStart": true,
  "scenario": { "type": "ride_script" }
}
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关 |
| `riderWeightKg` / `bikeWeightKg` | 75 / 8 | 速度物理模型（人+车重）|
| `crr` / `cdA` | 0.004 / 0.35 | 滚动阻力 / 风阻系数 |
| `fatigueFactor` | 0 | 每分钟功率衰减（0=无）|
| `cadenceCoupling` | `proportional` | `proportional` / `inverse` / `independent` |
| `microPauseProbability` | 0.005 | 每 tick 滑行停顿概率 |
| `autoStart` | `false`（ride_script 默认开启）| 无需 App 发 Start 即开始骑行 |
| `scenario` | `freeride` | 骑行场景（见下）|

### 场景

- **`steady`** — 仅自然微波动
- **`freeride`**（默认）— 基准功率每 60–180s 漂移 ±20%
- **`intervals`** — 高低功率交替
- **`warmup_main_cooldown`** — 热身→主课→冷却
- **`ride_script`** — 骑行剧本：一系列骑行动作（**起步/巡航/爬坡/冲刺/滑行/停车**），每个动作含目标功率、坡度、可选踏频；自动开始，`repeat: true` 循环，`stop` 动作功率/踏频/速度归零。不传 `phases` 用内置默认剧本。

---

## 热更新与稳定序列号

- **热更新**：运行中 + 同设备类型调 `ble_configure` **原地生效**——手机连接保持，下一条 notify 推送新值。设备类型变化才需重启（新序列号强制重新发现）。
- **稳定序列号**：`SIM_SERIAL_STABLE=1` 让同类型会话序列号稳定（`SIM001-FTMS`），手机 stop→start 后**无需忘记设备**即可无缝重连。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` 或 `http` |
| `MCP_PORT` / `MCP_HOST` | `3300` / `0.0.0.0` | HTTP 监听地址 |
| `SIM_DEVICE_PREFIX` | `OPEN_RIDE` | 广播名前缀 |
| `SIM_INSTANCE_ID_MODE` | — | 设备名实例 ID 模式 |
| `SIM_SERIAL_STABLE` | 未设置 | `1` = 同类型会话序列号稳定 |
| `SKILL_PUBLIC_URL` | `/skill/SKILL.md` | Skill 公网地址（`ble_get_version` 返回）|

---

### 源码结构

```
src/
├── index.ts             # 入口、生命周期
├── mcp-server.ts        # 17 个 MCP 工具定义与处理
├── ble-controller.ts    # BlueZ D-Bus 生命周期、广播、热更新
├── database.ts          # SQLite 层（sessions / saved_configs / logs）
├── config.ts            # 配置合并与默认值
├── version.ts           # 版本单一来源
├── simulator.ts         # 心率/电量模拟器
├── cycling-simulator.ts # 功率/踏频模拟器 + 物理模型 + ride_script 引擎
└── devices/             # 心率/功率/踏频/FTMS GATT 设备
```

BLE 外设通过**宿主机 BlueZ D-Bus** 工作（容器挂载宿主机 D-Bus socket）。设计记录见 `docs/design/*.md`。

---

## 许可证

[MIT](LICENSE) © BLE Simulator Contributors
