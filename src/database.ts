/**
 * SQLite 数据库层
 *
 * 存储每次的蓝牙模拟配置（session），支持多种设备类型。
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'ble-simulator.db');

// ─── Device Types ─────────────────────────────────────────────────────────────

export type DeviceType =
  | 'heart_rate'      // Heart Rate Monitor — 0x180D
  | 'cycling_power'   // Cycling Power Meter — 0x1818
  | 'csc'             // Cycling Speed & Cadence — 0x1816
  | 'ftms';           // Fitness Machine (Smart Trainer) — 0x1826

// ─── Shared Device Info (common to all device types) ─────────────────────────

export interface DeviceInfo {
  deviceName: string;
  serialNumber: string;
  modelNumber: string;
  firmwareRevision: string;
  hardwareRevision: string;
  softwareRevision: string;
  manufacturer: string;
}

// ─── Device-specific simulation parameters ───────────────────────────────────

export interface HeartRateParams {
  baseHeartRate: number;       // bpm, 40–200
  initialBattery: number;      // 0–100 %
  heartRateIntervalMs: number; // ms, 100–10000
  bodySensorLocation: number;  // 0–6
}

export interface CyclingPowerParams {
  basePowerWatts: number;        // watts
  cadenceRpm: number;            // rpm
  wheelCircumferenceMm: number;  // mm, e.g. 2096 for 700c×25
  sensorLocation: number;        // 0x00–0x10 (see spec)
  includeWheelRevData: boolean;
  includeCrankRevData: boolean;
  notifyIntervalMs: number;
  simulation?: CyclingSimulationConfig;
}

export interface CSCParams {
  speedKph: number;              // km/h
  cadenceRpm: number;            // rpm
  wheelCircumferenceMm: number;  // mm
  hasWheel: boolean;
  hasCrank: boolean;
  notifyIntervalMs: number;
  /** 引擎内部用于驱动速度物理模型的基准功率（不通过 BLE 上报） */
  basePowerWatts?: number;
  simulation?: CyclingSimulationConfig;
}

export interface FTMSParams {
  speedKph: number;           // km/h
  cadenceRpm: number;         // rpm
  powerWatts: number;         // W
  resistanceLevel: number;    // 1–100
  grade: number;              // % inclination
  notifyIntervalMs: number;
  minResistance: number;
  maxResistance: number;
  minPower: number;
  maxPower: number;
  /** 基准心率 (bpm)，0 = 不上报心率 */
  baseHeartRate: number;
  simulation?: CyclingSimulationConfig;
}

// ─── Cycling dynamic simulation ──────────────────────────────────────────────

/** 骑行场景模式 */
export type RidingScenario =
  | { type: 'steady' }
  | { type: 'intervals'; highPowerFactor: number; lowPowerFactor: number;
      intervalSeconds: number; restSeconds: number; sets: number }
  | { type: 'warmup_main_cooldown'; warmupMinutes: number; mainMinutes: number;
      cooldownMinutes: number; mainPowerFactor: number }
  | { type: 'freeride' }
  | { type: 'ride_script'; phases?: RidePhase[]; repeat?: boolean };

/** 骑行剧本阶段动作类型 */
export type RidePhaseType = 'start' | 'cruise' | 'climb' | 'sprint' | 'coast' | 'stop';

/** 骑行剧本中的一个阶段（动作） */
export interface RidePhase {
  /** 阶段动作类型 */
  type: RidePhaseType;
  /** 阶段持续时间（秒） */
  durationSeconds: number;
  /** 阶段目标功率（W） */
  targetPower: number;
  /** 阶段坡度（%，上坡为正、下坡为负） */
  grade: number;
  /** 阶段目标踏频（rpm，可选；stop 阶段自动为 0） */
  cadence?: number;
}

/** 默认骑行剧本：起步 → 巡航 → 爬坡 → 冲刺 → 下坡滑行 → 停车 */
export const DEFAULT_RIDE_SCRIPT_PHASES: RidePhase[] = [
  { type: 'start',  durationSeconds: 30,  targetPower: 60,  grade: 0,   cadence: 60 },
  { type: 'cruise', durationSeconds: 120, targetPower: 180, grade: 0,   cadence: 85 },
  { type: 'climb',  durationSeconds: 90,  targetPower: 260, grade: 5,   cadence: 75 },
  { type: 'sprint', durationSeconds: 30,  targetPower: 400, grade: 0,   cadence: 100 },
  { type: 'coast',  durationSeconds: 45,  targetPower: 80,  grade: -2,  cadence: 55 },
  { type: 'stop',   durationSeconds: 30,  targetPower: 0,   grade: 0 },
];

/** 骑行动态模拟配置（功率/踏频/速度拟真波动） */
export interface CyclingSimulationConfig {
  /** 启用动态模拟（false = 传统静态模式） */
  enabled: boolean;
  /** 骑手体重 (kg) */
  riderWeightKg: number;
  /** 车重 (kg) */
  bikeWeightKg: number;
  /** 滚动阻力系数（公路车典型 0.004） */
  crr: number;
  /** 风阻系数 × 迎风面积 (m²，公路车典型 0.35) */
  cdA: number;
  /** 骑行场景 */
  scenario: RidingScenario;
  /** 启动后自动进入骑行状态（无需外部 App 发送 Start；ride_script 场景默认自动启动） */
  autoStart?: boolean;
  /** 疲劳衰减率（0 = 无疲劳，0.001 = 每分钟衰减 0.1%） */
  fatigueFactor: number;
  /** 踏频耦合模式 */
  cadenceCoupling: 'proportional' | 'inverse' | 'independent';
  /** 踏频微停顿概率（每 tick，0-0.05） */
  microPauseProbability: number;
}

export const DEFAULT_CYCLING_SIMULATION: CyclingSimulationConfig = {
  enabled: false,
  riderWeightKg: 75,
  bikeWeightKg: 8,
  crr: 0.004,
  cdA: 0.35,
  scenario: { type: 'freeride' },
  fatigueFactor: 0,
  cadenceCoupling: 'proportional',
  microPauseProbability: 0.005,
};

// ─── Custom interaction rules ─────────────────────────────────────────────────

/**
 * 自定义交互规则：描述设备如何响应接收到的蓝牙指令。
 * 每条规则由触发条件（接收到什么）和动作（如何响应）组成。
 */
export interface InteractionRule {
  /** 规则标识 */
  id: string;
  /** 描述 */
  description: string;
  /** 触发条件：收到写入某个 characteristic 的数据 */
  trigger: {
    characteristicUuid: string;  // e.g. '2ad9'
    /** 匹配 opcode（第一个字节），null 表示匹配所有写入 */
    opcodeHex: string | null;    // e.g. '07' or null
  };
  /** 动作 */
  action: {
    type: 'indicate' | 'notify' | 'update_param';
    /** 若 type 是 indicate/notify：响应的 characteristic UUID */
    characteristicUuid?: string;
    /** 若 type 是 indicate/notify：响应数据的十六进制字符串 */
    responseHex?: string;
    /** 若 type 是 update_param：要更新的模拟参数字段名 */
    paramKey?: string;
    /** 若 type 是 update_param：从接收数据的哪个字节偏移读取值，null 表示使用 rawValue */
    paramByteOffset?: number | null;
    paramByteLength?: number;      // 1/2/4
    paramSigned?: boolean;
    paramScale?: number;           // 除以此值得到实际参数值
  };
}

// ─── Unified Simulation Config ────────────────────────────────────────────────

export interface SimulationConfig {
  deviceType: DeviceType;
  deviceInfo: DeviceInfo;
  /** 设备类型特定参数（根据 deviceType 使用对应字段） */
  heartRate?: HeartRateParams;
  cyclingPower?: CyclingPowerParams;
  csc?: CSCParams;
  ftms?: FTMSParams;
  /** 自定义交互规则 */
  interactionRules: InteractionRule[];
}

// ─── Default Configs ──────────────────────────────────────────────────────────

export const DEFAULT_DEVICE_INFO: DeviceInfo = {
  deviceName: 'OPEN_RIDE',
  serialNumber: 'ORI001',
  modelNumber: 'OPEN_RIDE',
  firmwareRevision: '1.0.0',
  hardwareRevision: '1.0',
  softwareRevision: '1.0.0',
  manufacturer: 'Open Ride',
};

export const DEFAULT_HEART_RATE_PARAMS: HeartRateParams = {
  baseHeartRate: 75,
  initialBattery: 85,
  heartRateIntervalMs: 1000,
  bodySensorLocation: 2,
};

export const DEFAULT_CYCLING_POWER_PARAMS: CyclingPowerParams = {
  basePowerWatts: 150,
  cadenceRpm: 80,
  wheelCircumferenceMm: 2096,
  sensorLocation: 0x06, // right crank
  includeWheelRevData: true,
  includeCrankRevData: true,
  notifyIntervalMs: 1000,
};

export const DEFAULT_CSC_PARAMS: CSCParams = {
  speedKph: 25,
  cadenceRpm: 80,
  wheelCircumferenceMm: 2096,
  hasWheel: true,
  hasCrank: true,
  notifyIntervalMs: 1000,
};

export const DEFAULT_FTMS_PARAMS: FTMSParams = {
  speedKph: 25,
  cadenceRpm: 80,
  powerWatts: 150,
  resistanceLevel: 5,
  grade: 0,
  notifyIntervalMs: 1000,
  minResistance: 1,
  maxResistance: 100,
  minPower: 0,
  maxPower: 4000,
  baseHeartRate: 120,
};

export function buildDefaultConfig(deviceType: DeviceType, deviceName: string, serialNumber: string): SimulationConfig {
  const deviceInfo: DeviceInfo = { ...DEFAULT_DEVICE_INFO, deviceName, serialNumber };
  switch (deviceType) {
    case 'heart_rate':
      return { deviceType, deviceInfo, heartRate: { ...DEFAULT_HEART_RATE_PARAMS }, interactionRules: [] };
    case 'cycling_power':
      return { deviceType, deviceInfo, cyclingPower: { ...DEFAULT_CYCLING_POWER_PARAMS }, interactionRules: [] };
    case 'csc':
      return { deviceType, deviceInfo, csc: { ...DEFAULT_CSC_PARAMS }, interactionRules: [] };
    case 'ftms':
      return { deviceType, deviceInfo, ftms: { ...DEFAULT_FTMS_PARAMS }, interactionRules: [] };
  }
}

// ─── Session Record ───────────────────────────────────────────────────────────

export interface SessionRecord {
  id: number;
  config: SimulationConfig;
  startedAt: string;
  stoppedAt: string | null;
  notes: string | null;
}

// ─── Connection Log ───────────────────────────────────────────────────────────

/**
 * 日志事件类型：
 *   simulator_start      — 模拟器启动
 *   simulator_stop       — 模拟器停止
 *   central_connected    — BLE 中心设备订阅 notify（建立连接）
 *   central_disconnected — BLE 中心设备取消订阅（断开连接）
 *   write_received       — 收到中心设备写入（控制指令）
 *   notify_sent          — 设备向已订阅的中心设备推送 notify 数据（心率、功率等）
 *   indicate_sent        — 向中心设备发送 indication 响应
 *   param_updated        — 模拟参数被写入指令更新
 *   error                — 运行时错误
 */
export type LogEventType =
  | 'simulator_start'
  | 'simulator_stop'
  | 'central_connected'
  | 'central_disconnected'
  | 'write_received'
  | 'notify_sent'
  | 'indicate_sent'
  | 'param_updated'
  | 'error';

export interface LogEntry {
  id: number;
  sessionId: number | null;
  eventType: LogEventType;
  /** 相关的 GATT Characteristic UUID（若适用） */
  characteristicUuid: string | null;
  /** 原始数据（十六进制字符串，若适用） */
  dataHex: string | null;
  /** 可读的描述信息 */
  message: string;
  timestamp: string;
}

// ─── Database ────────────────────────────────────────────────────────────────

export class SimulatorDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        config_json TEXT    NOT NULL,
        started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        stopped_at  TEXT,
        notes       TEXT
      );

      CREATE TABLE IF NOT EXISTS kv_store (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS connection_logs (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id          INTEGER,
        event_type          TEXT    NOT NULL,
        characteristic_uuid TEXT,
        data_hex            TEXT,
        message             TEXT    NOT NULL,
        timestamp           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
      );

      CREATE TABLE IF NOT EXISTS saved_configs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        config_json TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_logs_session ON connection_logs (session_id);
      CREATE INDEX IF NOT EXISTS idx_logs_event   ON connection_logs (event_type);
      CREATE INDEX IF NOT EXISTS idx_logs_ts      ON connection_logs (timestamp);
    `);
  }

  createSession(config: SimulationConfig, notes?: string): number {
    const result = this.db.prepare(`
      INSERT INTO sessions (config_json, started_at, notes)
      VALUES (?, datetime('now'), ?)
    `).run(JSON.stringify(config), notes ?? null);
    return result.lastInsertRowid as number;
  }

  stopSession(id: number): void {
    this.db.prepare(`UPDATE sessions SET stopped_at = datetime('now') WHERE id = ?`).run(id);
  }

  /** 热更新会话配置（不改变 stopped_at，用于运行中原地改参数） */
  updateSessionConfig(id: number, config: SimulationConfig): void {
    this.db.prepare(`UPDATE sessions SET config_json = ? WHERE id = ?`).run(JSON.stringify(config), id);
  }

  getLatestSession(): SessionRecord | null {
    return this.mapRow(this.db.prepare(`
      SELECT id, config_json, started_at, stopped_at, notes
      FROM sessions ORDER BY id DESC LIMIT 1
    `).get() as RawRow | undefined);
  }

  listSessions(limit = 20): SessionRecord[] {
    const rows = this.db.prepare(`
      SELECT id, config_json, started_at, stopped_at, notes
      FROM sessions ORDER BY id DESC LIMIT ?
    `).all(limit) as RawRow[];
    return rows.map((r) => this.mapRow(r)!);
  }

  getSession(id: number): SessionRecord | null {
    return this.mapRow(this.db.prepare(`
      SELECT id, config_json, started_at, stopped_at, notes
      FROM sessions WHERE id = ?
    `).get(id) as RawRow | undefined);
  }

  setKV(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO kv_store (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  getKV(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ─── Log methods ─────────────────────────────────────────────────────────────

  appendLog(entry: {
    sessionId: number | null;
    eventType: LogEventType;
    characteristicUuid?: string | null;
    dataHex?: string | null;
    message: string;
  }): void {
    this.db.prepare(`
      INSERT INTO connection_logs (session_id, event_type, characteristic_uuid, data_hex, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      entry.sessionId ?? null,
      entry.eventType,
      entry.characteristicUuid ?? null,
      entry.dataHex ?? null,
      entry.message,
    );
  }

  getLogs(opts: {
    sessionId?: number;
    eventTypes?: LogEventType[];
    limit?: number;
    offset?: number;
    since?: string;
  } = {}): LogEntry[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.sessionId !== undefined) {
      conditions.push('session_id = ?');
      params.push(opts.sessionId);
    }
    if (opts.eventTypes && opts.eventTypes.length > 0) {
      conditions.push(`event_type IN (${opts.eventTypes.map(() => '?').join(',')})`);
      params.push(...opts.eventTypes);
    }
    if (opts.since) {
      conditions.push('timestamp >= ?');
      params.push(opts.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(opts.limit ?? 100, 1000);
    const offset = opts.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT id, session_id, event_type, characteristic_uuid, data_hex, message, timestamp
      FROM connection_logs
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as RawLogRow[];

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      eventType: r.event_type as LogEventType,
      characteristicUuid: r.characteristic_uuid,
      dataHex: r.data_hex,
      message: r.message,
      timestamp: r.timestamp,
    }));
  }

  countLogs(opts: { sessionId?: number; eventTypes?: LogEventType[] } = {}): number {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.sessionId !== undefined) { conditions.push('session_id = ?'); params.push(opts.sessionId); }
    if (opts.eventTypes?.length) {
      conditions.push(`event_type IN (${opts.eventTypes.map(() => '?').join(',')})`);
      params.push(...opts.eventTypes);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as n FROM connection_logs ${where}`).get(...params) as { n: number };
    return row.n;
  }

  close(): void { this.db.close(); }

  private mapRow(row: RawRow | undefined): SessionRecord | null {
    if (!row) return null;
    return {
      id: row.id,
      config: JSON.parse(row.config_json) as SimulationConfig,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      notes: row.notes,
    };
  }

  // ─── Saved Configs（用户保存的命名配置，上限 20）──────────────────────────

  readonly SAVED_CONFIG_LIMIT = 20;

  countSavedConfigs(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM saved_configs').get() as { c: number }).c;
  }

  saveConfig(name: string, config: SimulationConfig): number {
    if (this.countSavedConfigs() >= this.SAVED_CONFIG_LIMIT) {
      throw new Error(`已保存配置达到上限 ${this.SAVED_CONFIG_LIMIT} 条，请先删除部分配置`);
    }
    const result = this.db.prepare(
      `INSERT INTO saved_configs (name, config_json) VALUES (?, ?)`,
    ).run(name, JSON.stringify(config));
    return result.lastInsertRowid as number;
  }

  listSavedConfigs(): { id: number; name: string; updatedAt: string; deviceType: string; deviceName: string }[] {
    const rows = this.db.prepare(
      `SELECT id, name, updated_at, config_json FROM saved_configs ORDER BY updated_at DESC`,
    ).all() as { id: number; name: string; updated_at: string; config_json: string }[];
    return rows.map((r) => {
      let dt = '', dn = '';
      try { const c = JSON.parse(r.config_json); dt = c.deviceType ?? ''; dn = c.deviceInfo?.deviceName ?? ''; } catch { /* ignore */ }
      return { id: r.id, name: r.name, updatedAt: r.updated_at, deviceType: dt, deviceName: dn };
    });
  }

  getSavedConfig(id: number): { id: number; name: string; config: SimulationConfig } | null {
    const row = this.db.prepare(
      `SELECT id, name, config_json FROM saved_configs WHERE id = ?`,
    ).get(id) as { id: number; name: string; config_json: string } | undefined;
    if (!row) return null;
    try { return { id: row.id, name: row.name, config: JSON.parse(row.config_json) as SimulationConfig }; }
    catch { return null; }
  }

  renameSavedConfig(id: number, name: string): void {
    this.db.prepare(`UPDATE saved_configs SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, id);
  }

  deleteSavedConfig(id: number): void {
    this.db.prepare(`DELETE FROM saved_configs WHERE id = ?`).run(id);
  }
}

interface RawRow {
  id: number;
  config_json: string;
  started_at: string;
  stopped_at: string | null;
  notes: string | null;
}

interface RawLogRow {
  id: number;
  session_id: number | null;
  event_type: string;
  characteristic_uuid: string | null;
  data_hex: string | null;
  message: string;
  timestamp: string;
}
