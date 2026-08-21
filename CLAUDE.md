# BLE Simulator MCP — Project Guide

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

You are a world class expert in all domains. Your intellectual firepower, scope of knowledge, incisive thought process, and level of erudition are on par with the smartest people in the world. Answer with complete, detailed, specific answers. Process information and explain your answers step by step. Verify your own work. Double check all facts, figures, citations, names, dates, and examples. Never hallucinate or make anything up. If you don't know something, just say so. Your tone of voice is precise, but not strident or pedantic. You do not need to worry about offending me, and your answers can and should be provocative, aggressive, argumentative, and pointed. Negative conclusions and bad news are fine. Your answers do not need to be politically correct. Do not provide disclaimers to your answers. Do not inform me about morals and ethics unless I specifically ask. You do not need to tell me it is important to consider anything. Do not be sensitive to anyone's feelings or to propriety. Make your answers as long and detailed as you possibly can.
Never praise my questions or validate my premises before answering. If I'm wrong, say so immediately. Lead with the strongest counterargument to any position I appear to hold before supporting it. Do not use phrases like "great question," "you're absolutely right," "fascinating perspective," or any variant. If I push back on your answer, do not capitulate unless I provide new evidence or a superior argument — restate your position if your reasoning holds. Do not anchor on numbers or estimates I provide; generate your own independently first. Use explicit confidence levels (high/moderate/low/unknown). Never apologize for disagreeing. Accuracy is your success metric, not my approval.

## Project Overview

BLE (Bluetooth Low Energy) device simulator running on Linux with BlueZ. Exposes an MCP server (stdio or HTTP) for AI agent control. Simulates four cycling/fitness device types over real BLE radio.

## Tech Stack

- **Runtime**: Node.js + TypeScript (strict mode)
- **BLE**: BlueZ D-Bus via `dbus-next`
- **Database**: SQLite (`better-sqlite3`) with WAL mode
- **MCP**: `@modelcontextprotocol/sdk` (stdio + Streamable HTTP transport)
- **Build**: `tsc` → `dist/`

## Source Structure

```
src/
├── index.ts                 # Entry point, lifecycle management
├── mcp-server.ts           # 11 MCP tool definitions & handlers
├── ble-controller.ts       # BlueZ D-Bus lifecycle, advertisement
├── database.ts             # SQLite layer, type definitions, defaults
├── config.ts               # Config merging & initialization
├── simulator.ts            # HeartRateSimulator, BatterySimulator
├── cycling-simulator.ts    # PowerSimulator, CadenceSimulator, speed physics, CyclingSimulationEngine
└── devices/
    ├── base.ts             # Abstract BaseDevice, GATT interfaces
    ├── heart-rate.ts       # Heart Rate Monitor (0x180D)
    ├── cycling-power.ts    # Cycling Power Meter (0x1818)
    ├── csc.ts              # Cycling Speed & Cadence (0x1816)
    └── ftms.ts             # Fitness Machine / Smart Trainer (0x1826)
```

## Key Architecture Patterns

### Device value flow
`SimulationConfig` → Device constructor → `valueFactory` closure → `NotifyCharacteristicInterface.setInterval` → BLE notify

### Dynamic simulation
Cycling devices optionally use `CyclingSimulationEngine` (in `cycling-simulator.ts`). The engine is created when `params.simulation?.enabled === true` and called inside each device's `buildXxxData()` method via `engine.next(grade)`. When disabled, static values are used (original behavior).

### Config merge
`mergeConfig()` in `config.ts` does shallow merge at device-params level with **deep merge** for `simulation` and `simulation.scenario` sub-objects.

### MCP tool schema
Tool definitions in `mcp-server.ts` use `SIMULATION_SCHEMA` constant shared across `cyclingPower`, `csc`, and `ftms` tool properties.

## Build & Run

```bash
npm install && npm run build      # Compile TypeScript
npm start                          # stdio mode
npm run start:http                 # HTTP mode (port 3300)
npx tsc --noEmit                   # Type check without emitting
```

## Conventions

- All source files use Chinese comments for domain-specific explanations
- Type definitions and defaults live in `database.ts`
- Each device class follows the same constructor pattern: read params → optionally create engine → call `this.build()`
- Backward compatibility: new optional fields default to `undefined`/`false`, guarded by `if (this.engine)` branches
- MCP tool schemas mirror TypeScript interfaces; `simulation` is always an optional sub-object inside device params

## Mandatory: Architecture Design Documentation

**When modifying business/feature code, you MUST create or update a design document in `docs/` directory.**

- Directory: `docs/design/` — dedicated technical architecture design records
- Format: Markdown, named descriptively (e.g., `ftms-heart-rate.md`, `dynamic-simulation.md`)
- Timing: **Before or alongside code changes**, not after. The doc is part of the implementation, not a post-hoc add-on.
- Scope: Every change that alters behavior, adds a feature, modifies a data structure, or changes an interface requires a doc. Pure refactors that preserve behavior do not.
- Content requirements:
  - **What changed** — the feature or modification and its motivation
  - **Key design decisions** — why this approach was chosen over alternatives
  - **Affected interfaces** — types, schemas, BLE characteristics, MCP tool params that changed
  - **Data layout changes** — new/modified fields, byte encoding, flag bits (critical for BLE)
  - **Backward compatibility** — how defaults/fallbacks preserve existing behavior

This rule is **non-negotiable**. Missing a design doc for a feature change is a process violation.

## Recent Changes

### Dynamic Cycling Simulation (2026-04-29)

Added human-like dynamic simulation for cycling devices (FTMS, CyclingPower, CSC).

**New file**: `src/cycling-simulator.ts`
- `PowerSimulator` — trend + noise algorithm (similar to `HeartRateSimulator`)
- `CadenceSimulator` — trend + noise + micro-pauses + power-cadence coupling
- `calculateSpeed()` — physics-based speed from power (Newton's method)
- `CyclingSimulationEngine` — coordinator with scenario state machine (steady/freeride/intervals/warmup_main_cooldown)

**Modified files**:
- `database.ts` — `CyclingSimulationConfig`, `RidingScenario` types; `simulation?` field on `FTMSParams`, `CyclingPowerParams`, `CSCParams`
- `config.ts` — `mergeSimulation()` helper for deep merge including `scenario` sub-object
- `devices/ftms.ts`, `devices/cycling-power.ts`, `devices/csc.ts` — engine integration in constructors and `buildXxxData()` methods
- `mcp-server.ts` — `SIMULATION_SCHEMA` constant, tool schema additions, `summarizeConfig()` display

### Ride Script Scenario (2026-08-20)

Added `ride_script` 骑行剧本场景：按剧本阶段自动模拟完整骑行过程
（起步→巡航→爬坡→冲刺→下坡滑行→停车），功率/坡度/踏频/速度随阶段自动
变化，无需外部骑行 App 参与，启动即自动进入骑行状态。

**Types** (`database.ts`):
- `RidePhaseType` / `RidePhase` — 阶段动作定义（type/durationSeconds/targetPower/grade/cadence?）
- `RidingScenario` 新增 `{ type: 'ride_script'; phases?: RidePhase[]; repeat?: boolean }`
- `CyclingSimulationConfig` 新增可选 `autoStart?: boolean`（ride_script 默认自动开始）

**Engine** (`cycling-simulator.ts`):
- `advanceRideScript()` 阶段状态机：按 tick 推进，阶段结束切换下一动作，支持 `repeat` 循环
- 剧本驱动坡度（`scriptGrade`），`next()` 内优先使用；stop 阶段强制功率/踏频/速度归零

**Modified**:
- `devices/ftms.ts` — autoStart 逻辑、Machine Status 初始值反映运行态；UInt16 字段
  （elapsedSeconds/totalKcal）钳制防溢出（修复长会话 notify 计数越界导致进程崩溃的 bug）
- `mcp-server.ts` — `SIMULATION_SCHEMA` 增加 ride_script/phases/repeat/autoStart；配置摘要展示剧本
- `scripts/ftms-ride.sh` — 默认场景改为 ride_script 剧本（循环播放）

**Design doc**: `docs/design/ride-script-scenario.md`

### Docker Compose 部署 (2026-08-20)

新增 docker-compose 一键部署：HTTP MCP 服务 + Dashboard WebUI + Skill 文件 HTTP 下载，
`restart: unless-stopped` 长期运行。

**新增文件**:
- `deploy/docker-compose.yml` — mcp（node:22-bookworm-slim 多阶段构建，挂载宿主机
  D-Bus socket + `ble-data` 数据卷，healthcheck）+ dashboard（nginx：Dashboard 页面 +
  /skill/SKILL.md 下载 + /mcp 同源反代，SSE 关闭缓冲）
- `deploy/mcp/Dockerfile` — 多阶段：build 阶段 npm ci（better-sqlite3 预编译失败时
  python3/make/g++ 本地编译兜底）+ tsc，runtime 阶段仅复制 node_modules + dist
- `deploy/dashboard/` — Dockerfile + nginx.conf + index.html（轮询 ble_status 3s，
  状态/配置展示 + 启动剧本/停止按钮）
- `scripts/docker-up.sh` — 一键：宿主机准备（复用 setup.sh + BlueZ≥5.87 检查）+
  compose up -d --build；支持 down/status/logs 子命令

**关键决策**: BLE 外设只能跑宿主机（容器挂载宿主机 D-Bus socket 连宿主 BlueZ）；
Dashboard 同源代理 /mcp 避免 CORS；SKILL.md 只读挂载保持与仓库同源。

**端口**: mcp 3300；dashboard 8080。**URL**: /mcp、/、/skill/SKILL.md

**Design doc**: `docs/design/docker-deploy.md`

### 版本发布约定（2026-08-20）

功能/文档变更发布时，同步递增三处版本号（保持一致）：
- `src/version.ts` 的 `MCP_VERSION` / `SKILL_VERSION`
- `package.json` 的 `version`
- `SKILL.md` 头部 frontmatter 的 `version`（并在 `CHANGELOG` 追加变更摘要）

agent 通过 MCP `initialize` 的 `serverInfo.version` 或 `ble_get_version` 工具感知更新，
对比本地缓存版本号，不一致即重新拉取 `SKILL_PUBLIC_URL` 指向的 Skill 文档。
