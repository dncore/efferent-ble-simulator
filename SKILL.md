---
name: efferent-ble-simulator
description: Deploy and operate the BLE Simulator MCP Service — covers both running the service on a local Linux/Bluetooth machine and controlling a already-running HTTP instance from any device on the LAN.
license: MIT
compatibility: opencode
version: 1.0.0
updated: 2026-08-21
---
# BLE Simulator MCP Skill

This skill covers two distinct usage modes. Identify which applies before proceeding.

---

## Mode A — Host: Deploy & Run the Service on the Local Machine

Use this mode when you are working **directly on the Linux machine that has a Bluetooth adapter** and need to install, build, and start the simulator service.

### Prerequisites

- Linux with BlueZ (bluetoothd), a BLE-capable adapter
- **BlueZ ≥ 5.87** — BlueZ 5.86 has an advertisement-registration bug (`src/advertising.c` uses the wrong struct size for `MGMT_OP_ADD_EXT_ADV_DATA`, sending 14 bytes instead of 6); on kernels with strict MGMT length validation this makes every `RegisterAdvertisement` fail with `Failed to register advertisement`. Upgrade before deploying: `sudo pacman -S bluez && sudo systemctl restart bluetooth`
- Node.js ≥ 18

### First-time setup

Run once with sudo before starting the service:

```bash
npm install
npm run setup    # requires sudo — installs D-Bus policy, enables bluetoothd, verifies GATT
npm run build
```

`npm run setup` (`scripts/setup.sh`) does the following automatically:
1. Installs BlueZ if missing (apt / pacman / dnf / zypper)
2. Enables and starts `bluetoothd`
3. Powers on the BLE adapter
4. Writes `/etc/dbus-1/system.d/ble-simulator.conf` — the critical step: without this policy file, `RegisterApplication()` silently fails and the device cannot be connected to or read from
5. Reloads D-Bus daemon so the policy takes effect immediately
6. Runs an end-to-end GATT registration smoke test and reports pass/fail

### Starting the service

**stdio mode** (default, for local MCP clients that launch the process directly):

```bash
npm start
# or: node dist/index.js
```

MCP client config:

```json
{
  "mcpServers": {
    "ble-simulator": {
      "command": "node",
      "args": ["/path/to/ble-simulator-node/dist/index.js"]
    }
  }
}
```

**HTTP mode** (exposes the service over the network so remote agents on the LAN can connect):

```bash
npm run start:http
# equivalent: MCP_TRANSPORT=http npm start
```

Custom port / bind address:

```bash
MCP_TRANSPORT=http MCP_PORT=8080 MCP_HOST=127.0.0.1 npm start
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_PORT` | `3300` | HTTP listen port |
| `SIM_SERIAL_STABLE` | unset | `1` = same-type sessions keep a stable serial (`SIM001-FTMS`), so a phone can reconnect after stop/start without forgetting the device; device-type changes still change the serial to force re-discovery. Default (unset) changes the serial every session (`SIM001-S42`) |
| `MCP_HOST` | `0.0.0.0` | HTTP bind address (`0.0.0.0` = all interfaces) |

### Symptom: device visible but not connectable

If a BLE scanner can see the simulated device name but cannot connect, or connects but sees no services, the D-Bus policy is missing. Fix:

```bash
npm run setup
```

---

### Docker Compose deployment (recommended for servers)

One command deploys the HTTP MCP service + status Dashboard + Skill file download,
with `restart: unless-stopped` for long-running operation.

```bash
git clone <repo-url> && cd ble-simulator-node
bash scripts/docker-up.sh          # host prep (sudo, once) + build + start
```

What it provides:

| URL | Purpose |
|---|---|
| `http://<host>:3300/mcp` | MCP endpoint (same as `npm run start:http`) |
| `http://<host>:3330/` | Dashboard — 复刻全部 MCP 工具：状态/参数表单控制(4 种设备+动态模拟+场景)/一键快捷模板(骑行剧本·FTP 测试·爬坡训练·冲刺间歇·恢复骑行·热身课等)/交互规则/会话管理/通信日志(折叠展开) |
| `http://<host>:3330/skill/SKILL.md` | This skill file, downloadable by other users |

Management:

```bash
DASH_PORT=3331 bash scripts/docker-up.sh   # 默认 3330，被占用时换端口
bash scripts/docker-up.sh status   # compose ps
bash scripts/docker-up.sh logs     # follow mcp logs
bash scripts/docker-up.sh down     # stop containers (data volume kept)
```

Notes:

- **BLE stays on the host**: the container mounts the host D-Bus socket
  (`/run/dbus/system_bus_socket`) and talks to the host's BlueZ. The host must
  have BlueZ ≥ 5.87 and the D-Bus policy installed — `scripts/docker-up.sh`
  runs `scripts/setup.sh` automatically on first deploy.
- **Zero-compile build**: better-sqlite3 uses a prebuilt binary (no compiler
  needed). If the build is slow / fails on a restricted network, switch to a
  mirror:
  ```bash
  NPM_REGISTRY=https://registry.npmmirror.com \
  BETTER_SQLITE3_BINARY_HOST_MIRROR=https://registry.npmmirror.com/-/binary/better-sqlite3 \
  bash scripts/docker-up.sh
  ```
- Data (SQLite) persists in the `ble-data` Docker volume across rebuilds.
- Deploy assets: `deploy/docker-compose.yml`, `deploy/mcp/Dockerfile`,
  `deploy/dashboard/`. Design: `docs/design/docker-deploy.md`.

## Mode B — Remote Agent: Control a Running HTTP Service on the LAN

Use this mode when the BLE Simulator is **already running in HTTP mode on another machine** (or the same machine) and you want to control it via MCP over HTTP. No Bluetooth hardware or Linux required on your side.

### Connect your MCP client

Point your MCP client at the running service:

```json
{
  "mcpServers": {
    "ble-simulator": {
      "type": "http",
      "url": "http://<device-ip>:3300/mcp"
    }
  }
}
```

Replace `<device-ip>` with the LAN IP of the machine running the simulator (e.g. `192.168.1.42`). The default port is `3300`.

### Available MCP Tools

| Tool | Purpose |
|---|---|
| `ble_start` | Start BLE simulation with specified device type and config |
| `ble_stop` | Stop the running BLE simulation |
| `ble_restart` | Restart with optional new config |
| `ble_status` | Query current state, active configuration and live device state (运行状态/阶段/功率/心率等) |
| `ble_configure` | Update config. **Running + same device type → hot-update in place** (keeps the phone connection, next notify applies); device-type change → full restart |
| `ble_get_config` | Get current/latest config as JSON (for form backfill / sharing with Dashboard) |
| `ble_save_config` | Save current params as a **named preset** (max 20, error beyond limit) |
| `ble_list_configs` | List saved named configs (id/name/type/updated) |
| `ble_get_config_detail` | Get a saved config's full JSON by id |
| `ble_rename_config` | Rename a saved config |
| `ble_delete_config` | Delete a saved config |
| `ble_set_interaction` | Add/replace a custom interaction rule |
| `ble_clear_interactions` | Remove all interaction rules |
| `ble_list_sessions` | List historical config sessions |
| `ble_get_session` | Get full details of a session by ID |
| `ble_get_logs` | Read persistent BLE communication logs |

### Config presets & hot update

- **Saved configs**: `ble_save_config {name, config?}` stores a named preset (max 20).
  `ble_list_configs` / `ble_get_config_detail {id}` / `ble_rename_config {id,name}` /
  `ble_delete_config {id}` manage them. The Dashboard「配置列表」tab shares this data.
- **Hot update**: while running, `ble_configure` with the **same device type** applies
  params **in place** — the connected phone keeps its link and receives the new values
  on the next notify (default 500ms). No restart, no re-pair. Device-type changes
  still require a full restart (new serial forces re-discovery).
- **Stable serial**: with `SIM_SERIAL_STABLE=1`, same-type stop→start keeps a stable
  serial (`SIM001-FTMS`), so a phone can reconnect without forgetting the device.

---

## Device Types

Always specify `deviceType` when starting. Four types are supported:

### `heart_rate` — Heart Rate Monitor (BLE 0x180D)
Simulates a wrist/chest heart rate sensor. Broadcasts HR measurements + battery level.

Key params (`heartRate` object):
- `baseHeartRate` — center bpm, 40–200 (default 75)
- `initialBattery` — starting battery %, 0–100 (default 85)
- `heartRateIntervalMs` — notification interval ms, 100–10000 (default 1000)
- `bodySensorLocation` — 0=Other, 1=Chest, 2=Wrist, 3=Finger, 4=Hand, 5=EarLobe, 6=Foot (default 2)

### `cycling_power` — Cycling Power Meter (BLE 0x1818)
Simulates a crank or pedal power meter. Broadcasts instantaneous power, optional wheel/crank revolution data.

Key params (`cyclingPower` object):
- `basePowerWatts` — center power output, 0–5000 (default 150)
- `cadenceRpm` — simulated cadence, 0–200 (default 80)
- `wheelCircumferenceMm` — wheel size in mm (default 2096 for 700c×25)
- `sensorLocation` — 0x05=Left Crank, 0x06=Right Crank, 0x07=Left Pedal, 0x08=Right Pedal, 0x0F=Spider
- `includeWheelRevData` — include wheel revolution data in packets (default true)
- `includeCrankRevData` — include crank revolution data in packets (default true)
- `notifyIntervalMs` — notification interval ms (default 1000)

### `csc` — Cycling Speed & Cadence Sensor (BLE 0x1816)
Simulates a speed sensor, cadence sensor, or combo sensor.

Key params (`csc` object):
- `speedKph` — simulated speed km/h, 0–150 (default 25)
- `cadenceRpm` — simulated cadence, 0–200 (default 80)
- `wheelCircumferenceMm` — wheel size in mm (default 2096)
- `hasWheel` — include wheel revolution data (default true)
- `hasCrank` — include crank revolution data (default true)
- `notifyIntervalMs` — notification interval ms (default 1000)

### `ftms` — Smart Trainer / Fitness Machine (BLE 0x1826)
Simulates a controllable indoor cycling trainer. Supports ERG mode (power target), resistance mode, and simulation mode (grade/wind).

Key params (`ftms` object):
- `speedKph` — simulated speed km/h (default 25)
- `cadenceRpm` — simulated cadence rpm (default 80)
- `powerWatts` — simulated power output W (default 150)
- `resistanceLevel` — resistance level 0–100 (default 5)
- `grade` — road gradient % −30 to +30 (default 0)
- `notifyIntervalMs` — Indoor Bike Data notification interval ms (default 1000)
- `minResistance` / `maxResistance` — resistance range (default 1–100)
- `minPower` / `maxPower` — power range W (default 0–4000)

---

## Dynamic Simulation (Cycling Devices)

Cycling devices (`cycling_power`, `csc`, `ftms`) support an optional **dynamic simulation mode** that produces human-like variations in power, cadence, and speed. When disabled (default), metrics remain static constants — the legacy behavior.

### Enabling dynamic simulation

Pass a `simulation` object inside the device-specific params:

```
ble_start({
  deviceType: "ftms",
  ftms: {
    powerWatts: 200,
    cadenceRpm: 85,
    simulation: {
      enabled: true,
      scenario: { type: "freeride" },
      riderWeightKg: 72,
      bikeWeightKg: 8
    }
  }
})
```

### Simulation parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Master switch for dynamic simulation |
| `riderWeightKg` | number | 75 | Rider weight in kg (for speed physics) |
| `bikeWeightKg` | number | 8 | Bike weight in kg |
| `crr` | number | 0.004 | Rolling resistance coefficient |
| `cdA` | number | 0.35 | Drag coefficient × frontal area (m²) |
| `fatigueFactor` | number | 0 | Power decay rate per minute (0 = no fatigue, 0.001 = 0.1%/min) |
| `cadenceCoupling` | string | `"proportional"` | How cadence responds to power changes: `proportional` / `inverse` / `independent` |
| `microPauseProbability` | number | 0.005 | Per-tick probability of a brief cadence drop to 0 (simulates coasting) |
| `autoStart` | boolean | `false` (`ride_script` 默认 `true`) | Start riding immediately without waiting for an external app to send FTMS Start. `ride_script` scenario auto-starts by default |
| `scenario` | object | `{ type: "freeride" }` | Riding scenario (see below) |

### Riding scenarios

**`steady`** — No base power changes. Natural micro-variations only.

```json
{ "type": "steady" }
```

**`freeride`** (default) — Base power randomly drifts ±20% every 60–180 seconds, simulating natural ride variation.

```json
{ "type": "freeride" }
```

**`intervals`** — Alternates between high and low power phases.

```json
{
  "type": "intervals",
  "highPowerFactor": 1.5,
  "lowPowerFactor": 0.5,
  "intervalSeconds": 30,
  "restSeconds": 60,
  "sets": 5
}
```

**`warmup_main_cooldown`** — Three-phase workout: linear warmup (50% → 100%), main set, linear cooldown.

```json
{
  "type": "warmup_main_cooldown",
  "warmupMinutes": 5,
  "mainMinutes": 20,
  "cooldownMinutes": 5,
  "mainPowerFactor": 1.2
}
```

**`ride_script`** — Scripted ride: plays a sequence of riding actions (start / cruise / climb / sprint / coast / stop) back to back. Each phase drives target power, grade (for speed physics) and optional cadence; the engine auto-starts without an app. Omit `phases` to use the built-in default script (起步→巡航→爬坡→冲刺→下坡滑行→停车).

```json
{
  "type": "ride_script",
  "repeat": true,
  "phases": [
    { "type": "start",  "durationSeconds": 30, "targetPower": 60,  "grade": 0,  "cadence": 60 },
    { "type": "climb",  "durationSeconds": 90, "targetPower": 260, "grade": 5,  "cadence": 75 },
    { "type": "sprint", "durationSeconds": 20, "targetPower": 400, "grade": 0,  "cadence": 100 },
    { "type": "stop",   "durationSeconds": 20, "targetPower": 0,   "grade": 0 }
  ]
}
```

Phase fields: `type` (`start`/`cruise`/`climb`/`sprint`/`coast`/`stop`), `durationSeconds`, `targetPower` (W), `grade` (% , uphill positive), optional `cadence` (rpm; `stop` is always 0). The `stop` phase zeroes power, cadence and speed (full stop). With `repeat: true` the script loops; without it, it stays in the last phase.

### Simulation algorithms

- **Power**: Trend-based drift (direction changes every 10–30s) + ±5W random noise per tick. Range clamped to [base×0.7, base×1.4]. Optional fatigue decay.
- **Cadence**: Slower drift (direction changes every 20–50s) + ±1 rpm noise. Coupled to power ratio via `cadenceCoupling` mode. Occasional micro-pauses (cadence drops to 0 for 2–4 ticks).
- **Speed**: Physics-derived from power using `P = F_roll×v + F_grade×v + F_aero×v³` (Newton's method). Not independently randomized.

### Cadence coupling modes

| Mode | Behavior |
|---|---|
| `proportional` | Power↑ → cadence slightly↑ (high-cadence road riding style) |
| `inverse` | Power↑ → cadence slightly↓ (grinding/climbing style) |
| `independent` | No coupling between power and cadence |

### Dynamic simulation with BLE control points

When dynamic simulation is enabled and a central device sends control commands (e.g. FTMS Set Target Power opcode `05`), the command updates the **base value** of the simulation engine. The engine then fluctuates around the new target. This is compatible with ERG mode, resistance mode, and simulation mode (grade/wind).

The FTMS Reset command (opcode `01`) also resets the engine state (tick counter, scenario phase, fatigue).

Note: with the `ride_script` scenario the script drives power and grade itself and the device auto-starts (`autoStart`); external control-point power/grade commands are applied as base values but the next script phase transition overrides them.

### CSC device note

CSC sensors don't natively have a power concept. When dynamic simulation is enabled, an internal `basePowerWatts` parameter (default 150W, configurable) drives the physics model to calculate speed. This value is never reported over BLE.

---

## Device Info (all device types)

Always passed in the `deviceInfo` object:
- `deviceName` — BLE advertised name (shown in phone scan list)
- `serialNumber` — device serial
- `modelNumber`, `firmwareRevision`, `hardwareRevision`, `softwareRevision`, `manufacturer`

---

## Custom Interaction Rules

Use `ble_set_interaction` to define how the simulated device responds to BLE write commands from a connected central (phone, app, head unit).

### Rule structure:

```json
{
  "id": "unique-rule-id",
  "description": "Human readable description",
  "trigger": {
    "characteristicUuid": "2ad9",
    "opcodeHex": "05"
  },
  "action": {
    "type": "indicate | notify | update_param",
    "characteristicUuid": "2ad9",
    "responseHex": "800501",
    "paramKey": "powerWatts",
    "paramByteOffset": 1,
    "paramByteLength": 2,
    "paramSigned": true,
    "paramScale": 1
  }
}
```

### Action types:

**`indicate`** — Send an indication response back on a characteristic.
Use `characteristicUuid` + `responseHex` (hex string, e.g. `"800101"`).

**`notify`** — Send a notification on a characteristic.
Same fields as indicate.

**`update_param`** — Read a value from the incoming write payload and update a simulation parameter.
- `paramKey`: the parameter to update (see table below)
- `paramByteOffset`: byte index in the received write buffer to start reading from
- `paramByteLength`: 1, 2, or 4 bytes
- `paramSigned`: true for signed integer (sint), false for unsigned (uint)
- `paramScale`: divide the raw integer by this to get the real value (e.g. 10 if unit is 0.1)

### Updatable parameter keys by device type:

| deviceType | paramKey | Description |
|---|---|---|
| `heart_rate` | `baseHeartRate` | Heart rate center value bpm |
| `heart_rate` | `initialBattery` | Battery % |
| `cycling_power` | `basePowerWatts` | Power output W |
| `cycling_power` | `cadenceRpm` | Cadence rpm |
| `csc` | `speedKph` | Speed km/h |
| `csc` | `cadenceRpm` | Cadence rpm |
| `ftms` | `powerWatts` | Power W |
| `ftms` | `resistanceLevel` | Resistance level |
| `ftms` | `grade` | Grade % |
| `ftms` | `speedKph` | Speed km/h |
| `ftms` | `cadenceRpm` | Cadence rpm |

### Key GATT Characteristic UUIDs for interaction rules:

| UUID | Service | Description |
|---|---|---|
| `2a37` | Heart Rate (180d) | HR Measurement (notify) |
| `2a63` | Cycling Power (1818) | Power Measurement (notify) |
| `2a66` | Cycling Power (1818) | CP Control Point (write+indicate) |
| `2a5b` | CSC (1816) | CSC Measurement (notify) |
| `2a55` | CSC (1816) | SC Control Point (write+indicate) |
| `2ad2` | FTMS (1826) | Indoor Bike Data (notify) |
| `2ad9` | FTMS (1826) | FM Control Point (write+indicate) |
| `2ada` | FTMS (1826) | FM Status (notify) |

### FTMS Control Point opcodes (for trigger.opcodeHex):

| Hex | Opcode | Parameters |
|---|---|---|
| `00` | Request Control | none |
| `01` | Reset | none |
| `04` | Set Target Resistance Level | sint16 LE ×0.1 at byte 1 |
| `05` | Set Target Power | sint16 LE W at byte 1 |
| `06` | Set Target Heart Rate | uint8 bpm at byte 1 |
| `07` | Start/Resume | none |
| `08` | Stop/Pause | uint8: 01=Stop, 02=Pause at byte 1 |
| `11` | Set Simulation Parameters | sint16 wind(0.001m/s), sint16 grade(0.01%), uint8 Crr, uint8 Cw |

### Cycling Power Control Point opcodes:

| Hex | Opcode | Description |
|---|---|---|
| `04` | Set Crank Length | uint16 LE ×0.1mm at byte 1 |
| `0c` | Start Offset Compensation | none |
| `0d` | Mask Measurement Content | uint16 bitmask at byte 1 |

---

## Reading Logs

Use `ble_get_logs` to retrieve the persistent communication log from the SQLite database.

### Log event types:

| eventType | Direction | When recorded |
|---|---|---|
| `simulator_start` | system | Simulator started successfully (`ble_start` / `ble_restart`) |
| `simulator_stop` | system | Simulator stopped (`ble_stop`) |
| `central_connected` | central→device | A central device (phone/app) subscribed to a notify characteristic |
| `central_disconnected` | central→device | Central unsubscribed from a notify characteristic |
| `write_received` | central→device | Central wrote to a characteristic (raw hex data included) |
| `notify_sent` | device→central | Device pushed a notify to the subscribed central (HR value, power, Indoor Bike Data, etc. — raw hex included) |
| `indicate_sent` | device→central | Simulator sent an indication response to central |
| `param_updated` | system | Simulation parameter updated by a write command |
| `error` | system | Runtime error (e.g. startup failure) |

> `notify_sent` is only recorded when a central is subscribed (after `central_connected`).

### Parameters:

```
ble_get_logs({
  sessionId: 5,           // filter to a specific session (optional)
  eventTypes: [           // filter to specific event types (optional)
    "central_connected",
    "write_received",
    "notify_sent"
  ],
  limit: 100,             // max records to return, 1–1000 (default 50)
  offset: 0,              // pagination offset (default 0)
  since: "2024-01-01T00:00:00"  // only events after this timestamp (optional)
})
```

Each log entry contains: `id`, `sessionId`, `eventType`, `characteristicUuid`, `dataHex`, `message`, `timestamp`.

---

## Common Workflows

### Start a heart rate monitor

```
ble_start({
  deviceType: "heart_rate",
  deviceInfo: { deviceName: "HR_SENSOR_01", manufacturer: "Example" },
  heartRate: { baseHeartRate: 75, initialBattery: 90 },
  notes: "Resting HR test"
})
```

### Start a smart trainer in ERG mode (static)

```
ble_start({
  deviceType: "ftms",
  deviceInfo: { deviceName: "TRAINER_ERG", manufacturer: "Example" },
  ftms: { powerWatts: 200, cadenceRpm: 90, speedKph: 30 }
})
```

### Start a smart trainer with realistic human simulation

```
ble_start({
  deviceType: "ftms",
  deviceInfo: { deviceName: "TRAINER_SIM", manufacturer: "Example" },
  ftms: {
    powerWatts: 200,
    cadenceRpm: 85,
    simulation: {
      enabled: true,
      riderWeightKg: 72,
      bikeWeightKg: 8,
      scenario: { type: "freeride" },
      cadenceCoupling: "proportional"
    }
  }
})
```

### Start a trainer with interval training simulation

```
ble_start({
  deviceType: "ftms",
  ftms: {
    powerWatts: 200,
    cadenceRpm: 85,
    simulation: {
      enabled: true,
      scenario: {
        type: "intervals",
        highPowerFactor: 1.5,
        lowPowerFactor: 0.5,
        intervalSeconds: 30,
        restSeconds: 60,
        sets: 8
      }
    }
  }
})
```

### Start a trainer with a scripted ride (no app required)

The `ride_script` scenario auto-starts riding and plays a sequence of actions; the trainer is immediately visible to a phone app without any Start command from the app.

```
ble_start({
  deviceType: "ftms",
  ftms: {
    powerWatts: 200,
    cadenceRpm: 85,
    simulation: {
      enabled: true,
      riderWeightKg: 72,
      bikeWeightKg: 8,
      scenario: {
        type: "ride_script",
        repeat: true
      },
      autoStart: true
    }
  }
})
```

### Configure FTMS to accept power target commands from the app

```
ble_set_interaction({
  id: "accept-power-target",
  description: "Respond Success to Set Target Power, update simulated power",
  trigger: { characteristicUuid: "2ad9", opcodeHex: "05" },
  action: {
    type: "indicate",
    characteristicUuid: "2ad9",
    responseHex: "800501"
  }
})

ble_set_interaction({
  id: "update-power-from-target",
  description: "Update simulated power from the target power command",
  trigger: { characteristicUuid: "2ad9", opcodeHex: "05" },
  action: {
    type: "update_param",
    paramKey: "powerWatts",
    paramByteOffset: 1,
    paramByteLength: 2,
    paramSigned: true,
    paramScale: 1
  }
})
```

### Configure FTMS to accept simulation grade commands

```
ble_set_interaction({
  id: "sim-params-response",
  description: "Respond Success to Set Simulation Parameters",
  trigger: { characteristicUuid: "2ad9", opcodeHex: "11" },
  action: {
    type: "indicate",
    characteristicUuid: "2ad9",
    responseHex: "801101"
  }
})

ble_set_interaction({
  id: "sim-params-grade",
  description: "Update simulated grade from simulation parameters",
  trigger: { characteristicUuid: "2ad9", opcodeHex: "11" },
  action: {
    type: "update_param",
    paramKey: "grade",
    paramByteOffset: 3,
    paramByteLength: 2,
    paramSigned: true,
    paramScale: 100
  }
})
```

### Switch device type (e.g. from HR to power meter)

```
ble_configure({
  deviceType: "cycling_power",
  deviceInfo: { deviceName: "POWER_METER_01" },
  cyclingPower: { basePowerWatts: 180, cadenceRpm: 85 }
})
```

### Check history and replay a past session

```
ble_list_sessions({ limit: 10 })
ble_get_session({ id: 3 })
ble_start({ ... })   // manually pass the config from get_session output
```

### Inspect connection and command activity

```
// See all connections and disconnections for the current session
ble_get_logs({
  sessionId: 5,
  eventTypes: ["central_connected", "central_disconnected"]
})

// See all control commands written by the connected app
ble_get_logs({
  sessionId: 5,
  eventTypes: ["write_received"],
  limit: 200
})

// See all data the device has pushed to the app (HR values, power, etc.)
ble_get_logs({
  sessionId: 5,
  eventTypes: ["notify_sent"],
  limit: 200
})

// See the full two-way communication (commands in + data out)
ble_get_logs({
  sessionId: 5,
  eventTypes: ["write_received", "notify_sent", "indicate_sent"]
})
```

---

## State Machine

The BLE controller follows this state machine:

```
stopped → [ble_start] → running → [ble_stop] → stopped
running → [ble_restart] → running
stopped → [ble_restart] → running
any state → [ble_configure] → (running: hot-restart) | (stopped: save only)
```

Always check `ble_status` before issuing `ble_start` if you are unsure of current state.

---

## Session and Log Persistence

Every `ble_start`, `ble_restart`, and `ble_configure` call writes a new session record to the SQLite database at `data/ble-simulator.db`. Sessions store the complete configuration including all interaction rules. Use `ble_list_sessions` and `ble_get_session` to inspect history.

All BLE communication events (connections, disconnections, writes, errors) are automatically appended to the `connection_logs` table and survive across restarts. Use `ble_get_logs` to query them with filtering by session, event type, and time range.
