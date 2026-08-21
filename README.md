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

Efferent simulates Bluetooth Low Energy (BLE) peripheral devices over a real radio (Linux BlueZ): **FTMS smart trainers**, **cycling power meters**, **speed/cadence sensors** and **heart rate monitors**. It exposes an **MCP server** (stdio or HTTP) so AI agents — and the bundled Web dashboard — can start, configure and monitor simulations as if controlling a real trainer.

---

## Features

- **4 device types** over real BLE radio: FTMS smart trainer (0x1826), Cycling Power (0x1818), Speed/Cadence (0x1816), Heart Rate (0x180D)
- **Full FTMS control point** support: Request Control / Start / Stop / Reset / Set Target Power / Set Resistance / Set Indoor Bike Simulation Params
- **Dynamic simulation**: human-like power/cadence drift + physics-based speed model (weight, grade, Crr, CdA), 5 riding scenarios including the scripted **ride_script**
- **Hot parameter update**: change params while running — the connected phone keeps its link and receives new values on the next notify (no re-pair)
- **Named config presets**: save / load / rename / delete up to 20 named configs, shared between MCP and Dashboard
- **17 MCP tools** for agents: control, configure, config presets, interaction rules, sessions, logs, live device state, version
- **Web dashboard** (React + shadcn/ui): status, forms, one-click ride templates, interaction rules, session/config management, live log side-panel
- **Docker Compose** one-command deployment (MCP + Dashboard + Skill file over HTTP), long-running with health checks
- **Versioned**: MCP `serverInfo.version` + `ble_get_version` let agents detect updates

---


## Runtime Environment

| Requirement | Detail |
|---|---|
| OS | **Linux only** — the simulator drives the host **BlueZ** over D-Bus |
| BlueZ | ≥ 5.87 (5.86 has an advertisement-registration bug) |
| Hardware | A **BLE-capable adapter** (built-in or USB dongle) is required to actually broadcast |
| D-Bus policy | `/etc/dbus-1/system.d/ble-simulator.conf` (installed by `npm run setup`) — required for non-root GATT registration |
| Docker | The mcp container **mounts the host D-Bus socket**; the BLE radio always stays on the host |
| Not supported | macOS / Windows natively (would need a different BLE stack); without any BLE adapter the MCP service runs but nothing is transmitted |

## Architecture

```
┌──────────────┐   MCP protocol    ┌───────────────────────────┐
│ AI Agent /   │ ◄───────────────► │ MCP Server (HTTP :3300)   │
│ MCP Client   │  stdio / :3300    │ Web Dashboard (:3330)     │
│ (Claude,     │                   └────────────┬──────────────┘
│  Codex, pi)  │                                │ BlueZ D-Bus (system bus)
└──────────────┘                                ▼
                                     ┌───────────────────────────┐
                                     │ Host Linux BlueZ          │
                                     │ bluetoothd + BLE adapter  │
                                     │ (D-Bus policy, ≥ 5.87)    │
                                     └────────────┬──────────────┘
                                                  │ HCI / radio
                                                  ▼
                                     ┌───────────────────────────┐
                                     │ BLE advertisement + GATT  │
                                     │ FTMS / Power / CSC / HR   │
                                     └────────────┬──────────────┘
                                                  │
                                     ┌────────────▼──────────────┐
                                     │ Phone / Cycling App       │
                                     │ (Zwift, Garmin, Strava...)│
                                     └───────────────────────────┘
```

## Device Types

| Type | BLE Service | Characteristics |
|---|---|---|
| **FTMS** smart trainer | 0x1826 | FM Feature, Indoor Bike Data (notify), Control Point (write/indicate), Status, Resistance/Power ranges |
| **Cycling Power** | 0x1818 | Power/Cadence measurement, wheel & crank data |
| **Speed/Cadence (CSC)** | 0x1816 | Wheel & crank revolution counters |
| **Heart Rate** | 0x180D | HR measurement, body sensor location, battery |

---

## Quick Start

### Prerequisites

- Linux with **BlueZ ≥ 5.87** (bluetoothd) and a BLE-capable adapter
  > BlueZ 5.86 has an advertisement-registration bug; on kernels with strict MGMT validation every `RegisterAdvertisement` fails. Upgrade first: `sudo pacman -S bluez && sudo systemctl restart bluetooth` (Arch) / `sudo apt install bluez` (Debian).
- Node.js ≥ 18

### 1. Native install

```bash
npm install
npm run setup     # sudo — installs D-Bus policy, enables bluetoothd, verifies GATT
npm run build
npm run start:http   # HTTP mode on :3300 (or npm start for stdio)
```

`npm run setup` writes `/etc/dbus-1/system.d/ble-simulator.conf` — **required** for non-root GATT registration (without it the device advertises but cannot be connected).

### 2. Docker Compose (recommended for servers)

```bash
bash scripts/docker-up.sh     # host prep (sudo, once) + build + start
```

| URL | Purpose |
|---|---|
| `http://<host>:3300/mcp` | MCP endpoint |
| `http://<host>:3330/` | Web dashboard |
| `http://<host>:3330/skill/SKILL.md` | Operation skill (for agents) |
| `http://<host>:3330/help` | Dashboard help page |

Zero-compile build (better-sqlite3 prebuilt binary); on restricted networks use a mirror:
```bash
NPM_REGISTRY=https://registry.npmmirror.com \
BETTER_SQLITE3_BINARY_HOST_MIRROR=https://registry.npmmirror.com/-/binary/better-sqlite3 \
bash scripts/docker-up.sh
```

Management: `bash scripts/docker-up.sh status|logs|down`

---

## MCP Tools (17)

| Tool | Purpose |
|---|---|
| `ble_start` / `ble_stop` / `ble_restart` | Start / stop / restart a simulation |
| `ble_status` | Controller state + active config + **live device state** (phase/power/cadence/HR) |
| `ble_configure` | Update config — **hot-updates in place** if running with the same device type |
| `ble_get_config` | Current/latest config as JSON (form backfill) |
| `ble_save_config` | Save current params as a named preset (**max 20**) |
| `ble_list_configs` / `ble_get_config_detail` | List / view saved presets |
| `ble_rename_config` / `ble_delete_config` | Rename / delete a preset |
| `ble_set_interaction` / `ble_clear_interactions` | Custom BLE write-response rules |
| `ble_list_sessions` / `ble_get_session` | Session history / detail |
| `ble_get_logs` | Persistent communication logs (connect/write/notify/error) |
| `ble_get_version` | MCP + Skill versions, changelog, Skill URL (for update detection) |

### Example

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

## Dynamic Simulation

Enable via `simulation` on FTMS / CyclingPower / CSC:

```json
"simulation": {
  "enabled": true,
  "riderWeightKg": 75, "bikeWeightKg": 8, "crr": 0.004, "cdA": 0.35,
  "fatigueFactor": 0.0005, "cadenceCoupling": "proportional", "microPauseProbability": 0.008,
  "autoStart": true,
  "scenario": { "type": "ride_script" }
}
```

| Param | Default | Description |
|---|---|---|
| `enabled` | `false` | Master switch |
| `riderWeightKg` / `bikeWeightKg` | 75 / 8 | Speed physics (rider+bike mass) |
| `crr` / `cdA` | 0.004 / 0.35 | Rolling resistance / drag area |
| `fatigueFactor` | 0 | Power decay per minute (0 = none) |
| `cadenceCoupling` | `proportional` | `proportional` / `inverse` / `independent` |
| `microPauseProbability` | 0.005 | Per-tick coasting pauses |
| `autoStart` | `false` (ride_script defaults on) | Start riding without an app sending Start |
| `scenario` | `freeride` | Riding scenario (below) |

### Scenarios

- **`steady`** — natural micro-variation only
- **`freeride`** (default) — base power drifts ±20% every 60–180s
- **`intervals`** — high/low power alternation
- **`warmup_main_cooldown`** — warmup → main → cooldown
- **`ride_script`** — scripted ride: a sequence of riding actions (**start / cruise / climb / sprint / coast / stop**), each with target power, grade and optional cadence; auto-starts, loops with `repeat: true`, `stop` zeroes power/cadence/speed. Omit `phases` to use the built-in default script.

---

## Hot Update & Stable Serial

- **Hot update**: `ble_configure` while running + same device type applies params **in place** — the connected phone keeps its link and receives updated values on the next notify. Device-type changes still restart (new serial forces re-discovery).
- **Stable serial**: `SIM_SERIAL_STABLE=1` keeps the serial stable across same-type sessions (`SIM001-FTMS`), so a phone can reconnect after stop/start **without forgetting the device**.

---

## Environment Variables

| Var | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` / `MCP_HOST` | `3300` / `0.0.0.0` | HTTP listen address |
| `SIM_DEVICE_PREFIX` | `OPEN_RIDE` | Advertised name prefix |
| `SIM_INSTANCE_ID_MODE` | — | Instance ID mode for the device name |
| `SIM_SERIAL_STABLE` | unset | `1` = stable serial for same-type sessions |
| `SKILL_PUBLIC_URL` | `/skill/SKILL.md` | Public Skill URL (returned by `ble_get_version`) |

---

### Source Layout

```
src/
├── index.ts             # entry, lifecycle
├── mcp-server.ts        # 17 MCP tool definitions & handlers
├── ble-controller.ts    # BlueZ D-Bus lifecycle, advertisement, hot-update
├── database.ts          # SQLite layer (sessions / saved_configs / logs)
├── config.ts            # config merge & defaults
├── version.ts           # version single-source
├── simulator.ts         # HeartRate / Battery simulators
├── cycling-simulator.ts # power/cadence simulators + physics + ride_script engine
└── devices/             # heart-rate / cycling-power / csc / ftms GATT devices
```

BLE peripheral access runs over the **host BlueZ D-Bus** (the container mounts the host D-Bus socket). See `docs/design/*.md` for design records.

---

## License

[MIT](LICENSE) © BLE Simulator Contributors
