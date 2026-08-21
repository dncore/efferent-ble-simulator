/**
 * MCP 服务器
 *
 * 工具列表：
 *   ble_start            — 启动 BLE 模拟（指定设备类型 + 配置）
 *   ble_stop             — 停止 BLE 模拟
 *   ble_restart          — 重启（可附带新配置）
 *   ble_status           — 查询运行状态
 *   ble_configure        — 更新配置（运行中自动热重启）
 *   ble_set_interaction  — 添加/替换自定义交互规则
 *   ble_clear_interactions — 清除全部交互规则
 *   ble_list_sessions    — 列出历史会话
 *   ble_get_session      — 获取指定会话详情
 *   ble_get_logs         — 读取持久化的设备通信日志
 *
 * 传输模式（由 startMcpServer 的 opts 控制）：
 *   stdio  — 标准输入/输出（本地 MCP 客户端，默认）
 *   http   — Streamable HTTP，监听指定端口，供远端 agent 通过网络访问
 */

import { createServer as createHttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BleController } from './ble-controller';
import {
  SimulatorDatabase, SimulationConfig, DeviceType,
  InteractionRule, DeviceInfo, CyclingSimulationConfig,
  HeartRateParams, CyclingPowerParams, CSCParams, FTMSParams,
  buildDefaultConfig, LogEventType,
} from './database';
import { buildInitialConfig, mergeConfig } from './config';
import { MCP_VERSION, SKILL_VERSION, SKILL_UPDATED_AT, CHANGELOG } from './version';

// ─── Simulation schema (reused across cycling device types) ──────────────────

const SIMULATION_SCHEMA = {
  type: 'object',
  description: '动态模拟设置（启用后功率/踏频/速度会模拟真人波动）',
  properties: {
    enabled: { type: 'boolean', description: '启用动态模拟（默认 false）' },
    riderWeightKg: { type: 'number', minimum: 30, maximum: 200, description: '骑手体重 (kg)' },
    bikeWeightKg: { type: 'number', minimum: 3, maximum: 25, description: '车重 (kg)' },
    crr: { type: 'number', minimum: 0.001, maximum: 0.01, description: '滚动阻力系数' },
    cdA: { type: 'number', minimum: 0.1, maximum: 1.0, description: '风阻系数×迎风面积 (m²)' },
    fatigueFactor: { type: 'number', minimum: 0, maximum: 0.01, description: '疲劳衰减率 (0=无疲劳)' },
    cadenceCoupling: { type: 'string', enum: ['proportional', 'inverse', 'independent'], description: '踏频耦合模式' },
    microPauseProbability: { type: 'number', minimum: 0, maximum: 0.05, description: '踏频微停顿概率' },
    scenario: {
      type: 'object', description: '骑行场景',
      properties: {
        type: { type: 'string', enum: ['steady', 'intervals', 'warmup_main_cooldown', 'freeride'], description: '场景类型' },
        highPowerFactor: { type: 'number', description: 'intervals: 高功率倍率' },
        lowPowerFactor: { type: 'number', description: 'intervals: 低功率倍率' },
        intervalSeconds: { type: 'number', description: 'intervals: 高强度持续秒数' },
        restSeconds: { type: 'number', description: 'intervals: 休息持续秒数' },
        sets: { type: 'number', description: 'intervals: 组数' },
        warmupMinutes: { type: 'number', description: 'warmup_main_cooldown: 热身分钟数' },
        mainMinutes: { type: 'number', description: 'warmup_main_cooldown: 主课分钟数' },
        cooldownMinutes: { type: 'number', description: 'warmup_main_cooldown: 冷却分钟数' },
        mainPowerFactor: { type: 'number', description: 'warmup_main_cooldown: 主课功率倍率' },
      },
    },
  },
} as const;

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'ble_get_version',
    description: '获取 MCP 服务与 Skill 文档的版本信息（含更新时间、Skill 下载地址、变更摘要）。agent 与本地缓存版本对比，变化即应重新拉取 Skill。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ble_start',
    description: '启动 BLE 设备模拟。支持四种设备类型：heart_rate（心率计）、cycling_power（功率计）、csc（码表/踏频器）、ftms（骑行台）。所有参数可选，未提供字段使用默认值或上次会话配置。',
    inputSchema: {
      type: 'object',
      properties: {
        deviceType: { type: 'string', enum: ['heart_rate', 'cycling_power', 'csc', 'ftms'], description: '设备类型' },
        deviceInfo: {
          type: 'object', description: '设备基本信息',
          properties: {
            deviceName: { type: 'string', description: '蓝牙广播名称' },
            serialNumber: { type: 'string' },
            modelNumber: { type: 'string' },
            firmwareRevision: { type: 'string' },
            hardwareRevision: { type: 'string' },
            softwareRevision: { type: 'string' },
            manufacturer: { type: 'string' },
          },
        },
        heartRate: {
          type: 'object', description: '心率计参数（deviceType=heart_rate 时使用）',
          properties: {
            baseHeartRate: { type: 'number', minimum: 40, maximum: 200 },
            initialBattery: { type: 'number', minimum: 0, maximum: 100 },
            heartRateIntervalMs: { type: 'number', minimum: 100, maximum: 10000 },
            bodySensorLocation: { type: 'number', minimum: 0, maximum: 6 },
          },
        },
        cyclingPower: {
          type: 'object', description: '功率计参数（deviceType=cycling_power 时使用）',
          properties: {
            basePowerWatts: { type: 'number', minimum: 0, maximum: 5000 },
            cadenceRpm: { type: 'number', minimum: 0, maximum: 200 },
            wheelCircumferenceMm: { type: 'number', minimum: 500, maximum: 3000 },
            sensorLocation: { type: 'number', minimum: 0, maximum: 16 },
            includeWheelRevData: { type: 'boolean' },
            includeCrankRevData: { type: 'boolean' },
            notifyIntervalMs: { type: 'number', minimum: 100, maximum: 10000 },
            simulation: SIMULATION_SCHEMA,
          },
        },
        csc: {
          type: 'object', description: '速度/踏频传感器参数（deviceType=csc 时使用）',
          properties: {
            speedKph: { type: 'number', minimum: 0, maximum: 150 },
            cadenceRpm: { type: 'number', minimum: 0, maximum: 200 },
            wheelCircumferenceMm: { type: 'number', minimum: 500, maximum: 3000 },
            hasWheel: { type: 'boolean' },
            hasCrank: { type: 'boolean' },
            notifyIntervalMs: { type: 'number', minimum: 100, maximum: 10000 },
            basePowerWatts: { type: 'number', minimum: 0, maximum: 5000, description: '动态模拟用基准功率（不通过 BLE 上报）' },
            simulation: SIMULATION_SCHEMA,
          },
        },
        ftms: {
          type: 'object', description: '骑行台参数（deviceType=ftms 时使用）',
          properties: {
            speedKph: { type: 'number', minimum: 0, maximum: 150 },
            cadenceRpm: { type: 'number', minimum: 0, maximum: 200 },
            powerWatts: { type: 'number', minimum: 0, maximum: 5000 },
            resistanceLevel: { type: 'number', minimum: 0, maximum: 100 },
            grade: { type: 'number', minimum: -30, maximum: 30 },
            notifyIntervalMs: { type: 'number', minimum: 100, maximum: 10000 },
            minResistance: { type: 'number' },
            maxResistance: { type: 'number' },
            minPower: { type: 'number' },
            maxPower: { type: 'number' },
            baseHeartRate: { type: 'number', minimum: 0, maximum: 220, description: '基准心率 (bpm)，0=不上报心率' },
            simulation: SIMULATION_SCHEMA,
          },
        },
        notes: { type: 'string', description: '本次会话备注' },
      },
    },
  },
  {
    name: 'ble_stop',
    description: '停止当前 BLE 模拟。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ble_restart',
    description: '重启 BLE 模拟，可选传入新配置（与 ble_start 参数格式相同）。',
    inputSchema: {
      type: 'object',
      properties: {
        deviceType: { type: 'string', enum: ['heart_rate', 'cycling_power', 'csc', 'ftms'] },
        deviceInfo: { type: 'object' },
        heartRate: { type: 'object' },
        cyclingPower: { type: 'object' },
        csc: { type: 'object' },
        ftms: { type: 'object' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'ble_status',
    description: '查询 BLE 模拟器当前状态、设备类型和配置。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ble_configure',
    description: '更新设备模拟配置（部分或全部字段）。若模拟器正在运行，自动热重启生效。',
    inputSchema: {
      type: 'object',
      properties: {
        deviceType: { type: 'string', enum: ['heart_rate', 'cycling_power', 'csc', 'ftms'] },
        deviceInfo: { type: 'object' },
        heartRate: { type: 'object' },
        cyclingPower: { type: 'object' },
        csc: { type: 'object' },
        ftms: { type: 'object' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'ble_set_interaction',
    description: [
      '添加或替换一条自定义交互规则，定义设备如何响应蓝牙中心设备的写入操作。',
      '',
      '触发条件：当某个 characteristic（由 UUID 指定）收到写入时，可选匹配第一个字节（opcode）。',
      '动作类型：',
      '  - indicate：向指定 characteristic 发送一个 indication 响应（responseHex 为十六进制字节串）',
      '  - notify：向指定 characteristic 发送一个 notification',
      '  - update_param：从写入数据中读取参数值并更新模拟参数（如功率、心率等）',
      '',
      '示例：监听 FTMS Control Point (2ad9) 的 opcode=05（Set Target Power），',
      '      自动更新 powerWatts 参数：',
      '        trigger: { characteristicUuid: "2ad9", opcodeHex: "05" }',
      '        action: { type: "update_param", paramKey: "powerWatts", paramByteOffset: 1, paramByteLength: 2, paramSigned: true, paramScale: 1 }',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      required: ['id', 'description', 'trigger', 'action'],
      properties: {
        id: { type: 'string', description: '规则唯一标识（同 ID 会覆盖旧规则）' },
        description: { type: 'string', description: '规则说明' },
        trigger: {
          type: 'object',
          required: ['characteristicUuid'],
          properties: {
            characteristicUuid: { type: 'string', description: 'characteristic UUID，如 "2ad9"' },
            opcodeHex: { type: 'string', description: '匹配 opcode（首字节十六进制），null 表示匹配所有写入' },
          },
        },
        action: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['indicate', 'notify', 'update_param'] },
            characteristicUuid: { type: 'string', description: '响应的 characteristic UUID' },
            responseHex: { type: 'string', description: '响应数据十六进制串，如 "800101"' },
            paramKey: { type: 'string', description: 'update_param 时的参数字段名' },
            paramByteOffset: { type: 'number', description: '从接收数据的哪个字节读取' },
            paramByteLength: { type: 'number', enum: [1, 2, 4], description: '读取字节数' },
            paramSigned: { type: 'boolean', description: '是否有符号整数' },
            paramScale: { type: 'number', description: '除以此值得到实际参数值（如 10 表示单位是 0.1）' },
          },
        },
      },
    },
  },
  {
    name: 'ble_clear_interactions',
    description: '清除当前配置中的所有自定义交互规则。若正在运行则热重启生效。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ble_list_sessions',
    description: '列出历史配置会话（倒序）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 50, description: '返回数量上限，默认 10' },
      },
    },
  },
  {
    name: 'ble_get_session',
    description: '获取指定 session ID 的完整配置。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'number', description: 'Session ID' } },
    },
  },
  {
    name: 'ble_get_config',
    description: '获取当前模拟器配置（JSON）。优先返回运行中的配置，否则返回最近一次会话配置；用于 Dashboard 表单回填，与 MCP 共享同一份持久化数据。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ble_save_config',
    description: '保存当前模拟参数为命名配置（供后续载入）。最多保存 20 条，超出返回上限提示。name 必填；config 可选（不传则保存当前运行/最近配置）。',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: '配置名称' },
        config: { type: 'object', description: '完整配置（deviceType/deviceInfo/设备参数），Dashboard 表单传入' },
      },
    },
  },
  {
    name: 'ble_list_configs',
    description: '列出已保存的命名配置（id/名称/更新时间/设备类型）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ble_get_config_detail',
    description: '获取已保存配置的完整 JSON（用于查看或载入表单）。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'number', description: '配置 ID' } },
    },
  },
  {
    name: 'ble_rename_config',
    description: '重命名已保存配置。',
    inputSchema: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'number' }, name: { type: 'string' } },
    },
  },
  {
    name: 'ble_delete_config',
    description: '删除已保存配置。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'number' } },
    },
  },
  {
    name: 'ble_get_logs',
    description: [
      '读取持久化的 BLE 设备通信日志，包含连接/断开、控制指令写入、设备推送数据、参数变更、模拟器启停、错误等事件。',
      '',
      '事件类型说明：',
      '  simulator_start      — 模拟器启动',
      '  simulator_stop       — 模拟器停止',
      '  central_connected    — 中心设备（手机/App）订阅 notify，即建立连接',
      '  central_disconnected — 中心设备取消订阅，即断开连接',
      '  write_received       — 收到中心设备写入的控制指令（含原始十六进制数据）',
      '  notify_sent          — 设备向已订阅的中心设备推送 notify 数据（心率值、功率值、Indoor Bike Data 等，含原始十六进制）',
      '  indicate_sent        — 向中心设备发送 indication 响应',
      '  param_updated        — 模拟参数被控制指令更新（如功率、阻力等）',
      '  error                — 运行时错误',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'number', description: '过滤指定 session 的日志；不填则返回所有 session' },
        eventTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['simulator_start', 'simulator_stop', 'central_connected', 'central_disconnected', 'write_received', 'notify_sent', 'indicate_sent', 'param_updated', 'error'],
          },
          description: '只返回指定类型的事件；不填则返回全部类型',
        },
        limit: { type: 'number', minimum: 1, maximum: 1000, description: '返回条数上限，默认 50，最大 1000' },
        offset: { type: 'number', minimum: 0, description: '分页偏移，默认 0' },
        since: { type: 'string', description: '只返回此时间戳之后的日志（ISO 8601，如 "2024-01-01T00:00:00"）' },
      },
    },
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(content: string, isError = false) {
  return { content: [{ type: 'text' as const, text: content }], isError };
}

function summarizeConfig(cfg: SimulationConfig): string {
  const info = cfg.deviceInfo;
  const lines: string[] = [
    `设备类型: ${cfg.deviceType}`,
    `设备名称: ${info.deviceName}`,
    `序列号: ${info.serialNumber}`,
    `制造商: ${info.manufacturer}`,
    `型号: ${info.modelNumber}`,
    `固件: ${info.firmwareRevision} | 硬件: ${info.hardwareRevision} | 软件: ${info.softwareRevision}`,
  ];
  if (cfg.heartRate) {
    const p = cfg.heartRate;
    lines.push(`基准心率: ${p.baseHeartRate} bpm | 初始电量: ${p.initialBattery}% | 间隔: ${p.heartRateIntervalMs}ms`);
    lines.push(`传感器位置: ${p.bodySensorLocation}`);
  }
  if (cfg.cyclingPower) {
    const p = cfg.cyclingPower;
    lines.push(`基准功率: ${p.basePowerWatts}W | 踏频: ${p.cadenceRpm}rpm | 轮周长: ${p.wheelCircumferenceMm}mm`);
    lines.push(`包含轮圈数据: ${p.includeWheelRevData} | 包含曲柄数据: ${p.includeCrankRevData}`);
    if (p.simulation?.enabled) {
      lines.push(`动态模拟: 开启 | 场景: ${p.simulation.scenario.type} | 耦合: ${p.simulation.cadenceCoupling}`);
      lines.push(`骑手: ${p.simulation.riderWeightKg}kg | 车重: ${p.simulation.bikeWeightKg}kg | CdA: ${p.simulation.cdA}`);
    }
  }
  if (cfg.csc) {
    const p = cfg.csc;
    lines.push(`速度: ${p.speedKph}km/h | 踏频: ${p.cadenceRpm}rpm | 轮周长: ${p.wheelCircumferenceMm}mm`);
    lines.push(`有轮: ${p.hasWheel} | 有曲柄: ${p.hasCrank}`);
    if (p.simulation?.enabled) {
      lines.push(`动态模拟: 开启 | 场景: ${p.simulation.scenario.type} | 耦合: ${p.simulation.cadenceCoupling}`);
    }
  }
  if (cfg.ftms) {
    const p = cfg.ftms;
    lines.push(`速度: ${p.speedKph}km/h | 踏频: ${p.cadenceRpm}rpm | 功率: ${p.powerWatts}W | 心率: ${p.baseHeartRate > 0 ? p.baseHeartRate + 'bpm' : '关闭'}`);
    lines.push(`阻力: ${p.resistanceLevel} | 坡度: ${p.grade}% | 功率范围: ${p.minPower}–${p.maxPower}W`);
    if (p.simulation?.enabled) {
      lines.push(`动态模拟: 开启 | 场景: ${p.simulation.scenario.type} | 耦合: ${p.simulation.cadenceCoupling}`);
      lines.push(`骑手: ${p.simulation.riderWeightKg}kg | 车重: ${p.simulation.bikeWeightKg}kg | CdA: ${p.simulation.cdA}`);
      if (p.simulation.autoStart || p.simulation.scenario.type === 'ride_script') {
        lines.push('自动开始: 是（启动即骑行，无需 App 发 Start）');
      }
      if (p.simulation.scenario.type === 'ride_script') {
        const phases = p.simulation.scenario.phases ?? [];
        if (phases.length > 0) {
          lines.push(`骑行剧本 (${phases.length} 个动作${p.simulation.scenario.repeat ? ', 循环' : ''}):`);
          for (const ph of phases) {
            const name = ({
              start: '起步', cruise: '巡航', climb: '爬坡', sprint: '冲刺', coast: '滑行', stop: '停车',
            } as Record<string, string>)[ph.type] ?? ph.type;
            lines.push(`  ${name} ${ph.durationSeconds}s @ ${ph.targetPower}W 坡度${ph.grade}%${ph.cadence !== undefined ? ` 踏频${ph.cadence}rpm` : ''}`);
          }
        }
      }
    }
  }
  if (cfg.interactionRules.length > 0) {
    lines.push(`自定义交互规则: ${cfg.interactionRules.length} 条`);
    for (const r of cfg.interactionRules) {
      lines.push(`  [${r.id}] ${r.description} | 触发: ${r.trigger.characteristicUuid}${r.trigger.opcodeHex ? ` opcode=${r.trigger.opcodeHex}` : ''} → ${r.action.type}`);
    }
  }
  return lines.join('\n');
}

type StartInput = {
  deviceType?: DeviceType;
  deviceInfo?: Partial<DeviceInfo>;
  heartRate?: Partial<HeartRateParams>;
  cyclingPower?: Partial<CyclingPowerParams>;
  csc?: Partial<CSCParams>;
  ftms?: Partial<FTMSParams>;
  notes?: string;
};

function buildConfigFromInput(base: SimulationConfig, input: StartInput): SimulationConfig {
  const partial: Partial<SimulationConfig> = {};
  if (input.deviceType) partial.deviceType = input.deviceType;
  if (input.deviceInfo) partial.deviceInfo = input.deviceInfo as DeviceInfo;
  if (input.heartRate) partial.heartRate = input.heartRate as HeartRateParams;
  if (input.cyclingPower) partial.cyclingPower = input.cyclingPower as CyclingPowerParams;
  if (input.csc) partial.csc = input.csc as CSCParams;
  if (input.ftms) partial.ftms = input.ftms as FTMSParams;

  let cfg = mergeConfig(base, partial);

  // If deviceType changed and the new type has no params yet, fill defaults
  if (input.deviceType && input.deviceType !== base.deviceType) {
    const defaults = buildDefaultConfig(input.deviceType, cfg.deviceInfo.deviceName, cfg.deviceInfo.serialNumber);
    cfg = mergeConfig(defaults, partial);
  }
  return cfg;
}

// ─── Transport options ────────────────────────────────────────────────────────

export interface McpServerOptions {
  /** 传输模式：'stdio'（默认）或 'http' */
  transport?: 'stdio' | 'http';
  /** HTTP 模式监听端口，默认 3300 */
  port?: number;
  /** HTTP 模式监听地址，默认 '0.0.0.0'（所有网口） */
  host?: string;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

function createServer(controller: BleController, db: SimulatorDatabase): Server {
  const server = new Server(
    { name: 'efferent-ble-simulator', version: MCP_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as StartInput & { id?: unknown; limit?: number; notes?: string };

    try {
      switch (name) {

        // ── ble_get_version ────────────────────────────────────────────────────
        case 'ble_get_version': {
          const skillUrl = process.env['SKILL_PUBLIC_URL'] ?? '/skill/SKILL.md';
          const latest = CHANGELOG[0];
          const lines = [
            `MCP 服务版本: ${MCP_VERSION}`,
            `Skill 文档版本: ${SKILL_VERSION}（更新: ${SKILL_UPDATED_AT}）`,
            `Skill 下载: ${skillUrl}`,
            '',
            `最近变更 (${latest.version} / ${latest.date}): ${latest.summary}`,
            '',
            '更新检查：与本地缓存的版本号对比，不一致即应重新获取 Skill 文档。',
          ];
          return text(lines.join('\n'));
        }

        // ── ble_start ──────────────────────────────────────────────────────────
        case 'ble_start': {
          const status = controller.getStatus();
          if (status.state !== 'stopped') {
            return text(`当前状态为 "${status.state}"，请先停止再启动。`);
          }
          const lastSession = db.getLatestSession();
          const baseDeviceType: DeviceType = (input.deviceType ?? lastSession?.config.deviceType ?? 'heart_rate');
          const base = lastSession?.config ?? buildInitialConfig(baseDeviceType);
          const cfg = buildConfigFromInput(base, input as StartInput);
          const sessionId = db.createSession(cfg, input.notes);
          db.setKV('active_session_id', String(sessionId));
          await controller.start(cfg, sessionId);
          return text(`BLE 模拟器已启动。Session ID: ${sessionId}\n\n${summarizeConfig(cfg)}`);
        }

        // ── ble_stop ───────────────────────────────────────────────────────────
        case 'ble_stop': {
          const status = controller.getStatus();
          if (status.state !== 'running') {
            return text(`当前状态为 "${status.state}"，无需停止。`);
          }
          if (status.sessionId !== null) db.stopSession(status.sessionId);
          await controller.stop();
          return text('BLE 模拟器已停止。');
        }

        // ── ble_restart ────────────────────────────────────────────────────────
        case 'ble_restart': {
          const status = controller.getStatus();
          const base = status.config ?? db.getLatestSession()?.config ?? buildInitialConfig();
          const cfg = buildConfigFromInput(base, input as StartInput);
          if (status.state === 'running' && status.sessionId !== null) db.stopSession(status.sessionId);
          const sessionId = db.createSession(cfg, input.notes);
          db.setKV('active_session_id', String(sessionId));
          await controller.restart(cfg, sessionId);
          return text(`BLE 模拟器已重启。Session ID: ${sessionId}\n\n${summarizeConfig(cfg)}`);
        }

        // ── ble_status ─────────────────────────────────────────────────────────
        case 'ble_status': {
          const status = controller.getStatus();
          const lines = [
            `状态: ${status.state}`,
            `适配器: ${status.adapterPath ?? '—'}`,
            `启动时间: ${status.startedAt?.toISOString() ?? '—'}`,
            `Session ID: ${status.sessionId ?? '—'}`,
          ];
          if (status.config) {
            lines.push('', '当前配置:', ...summarizeConfig(status.config).split('\n').map((l) => `  ${l}`));
          }
          if (status.error) lines.push('', `最近错误: ${status.error}`);

          // 设备实时运行状态（模拟控制状态）
          const live = controller.getLiveState();
          if (Object.keys(live).length > 0) {
            lines.push('', '设备运行状态:');
            const stateMap: Record<string, string> = { running: '骑行中', paused: '已暂停', idle: '未开始' };
            const phaseMap: Record<string, string> = {
              start: '起步', cruise: '巡航', climb: '爬坡', sprint: '冲刺', coast: '滑行', stop: '停车',
            };
            const machine = live.machineState !== undefined
              ? stateMap[String(live.machineState)] ?? String(live.machineState) : '';
            const scenario = live.scenario ? ` | 场景: ${live.scenario}` : '';
            const phase = live.phase ? ` | 阶段: ${phaseMap[String(live.phase)] ?? String(live.phase)}` : '';
            if (machine) lines.push(`  运行状态: ${machine}${scenario}${phase}`);
            if (live.grade !== undefined) lines.push(`  坡度: ${live.grade}%`);
            const parts = [
              live.power !== undefined ? `功率: ${live.power}W` : '',
              live.cadence !== undefined ? `踏频: ${live.cadence}rpm` : '',
              live.speedKph !== undefined ? `速度: ${live.speedKph}km/h` : '',
              live.heartRate !== undefined ? `心率: ${live.heartRate}bpm` : '',
            ].filter(Boolean);
            if (parts.length) lines.push(`  ${parts.join(' | ')}`);
            if (live.elapsedSeconds !== undefined) {
              lines.push(`  已骑行: ${Math.floor(Number(live.elapsedSeconds) / 60)}min`);
            }
          }
          return text(lines.join('\n'));
        }

        // ── ble_configure ──────────────────────────────────────────────────────
        case 'ble_configure': {
          const status = controller.getStatus();
          const base = status.config ?? db.getLatestSession()?.config ?? buildInitialConfig();
          const cfg = buildConfigFromInput(base, input as StartInput);
          if (status.state === 'running') {
            // 同设备类型 → 原地热更新：保持手机连接，下一条 notify 即生效
            if (status.config?.deviceType === cfg.deviceType) {
              await controller.updateParams(cfg);
              if (status.sessionId !== null) db.updateSessionConfig(status.sessionId, cfg);
              return text(`配置已热更新（连接保持，实时生效）。Session ID: ${status.sessionId}\n\n${summarizeConfig(cfg)}`);
            }
            // 设备类型变化 → 完整重启
            if (status.sessionId !== null) db.stopSession(status.sessionId);
            const sessionId = db.createSession(cfg, input.notes ?? '配置更新');
            db.setKV('active_session_id', String(sessionId));
            await controller.restart(cfg, sessionId);
            return text(`配置已更新并重启（设备类型变化，需重新连接）。Session ID: ${sessionId}\n\n${summarizeConfig(cfg)}`);
          }
          const sessionId = db.createSession(cfg, input.notes ?? '配置更新');
          db.setKV('active_session_id', String(sessionId));
          return text(`配置已保存（模拟器未运行，下次启动生效）。Session ID: ${sessionId}\n\n${summarizeConfig(cfg)}`);
        }

        // ── ble_save_config / ble_list_configs / detail / rename / delete ───────
        case 'ble_save_config': {
          const input2 = args as { name?: string; config?: Partial<SimulationConfig> };
          const name = input2.name?.trim();
          if (!name) return text('错误: 需要提供配置名称 name。', true);
          let cfg: SimulationConfig;
          if (input2.config?.deviceType) {
            const base = controller.getStatus().config ?? db.getLatestSession()?.config ?? buildInitialConfig(input2.config.deviceType);
            cfg = buildConfigFromInput(base, input2.config as StartInput);
          } else {
            const cur = controller.getStatus().config ?? db.getLatestSession()?.config;
            if (!cur) return text('错误: 当前没有可用配置，请先启动模拟或传入 config。', true);
            cfg = cur;
          }
          try {
            const id = db.saveConfig(name, cfg);
            return text(`配置已保存：${name} (ID: ${id})，共 ${db.countSavedConfigs()}/${db.SAVED_CONFIG_LIMIT} 条`);
          } catch (e) {
            return text(`保存失败: ${e instanceof Error ? e.message : e}`, true);
          }
        }

        case 'ble_list_configs': {
          const list = db.listSavedConfigs();
          if (list.length === 0) return text('暂无已保存配置。');
          const lines = [`共 ${list.length}/${db.SAVED_CONFIG_LIMIT} 条已保存配置:`];
          for (const c of list) {
            lines.push(`  #${c.id} [${c.name}] ${c.deviceType}${c.deviceName ? ' / ' + c.deviceName : ''} | 更新: ${c.updatedAt}`);
          }
          return text(lines.join('\n'));
        }

        case 'ble_get_config_detail': {
          const id = Number((args as { id?: number }).id);
          if (!id || isNaN(id)) return text('错误: 需要提供有效的配置 id。', true);
          const rec = db.getSavedConfig(id);
          if (!rec) return text(`未找到配置 id=${id}。`);
          return text(JSON.stringify(rec, null, 2));
        }

        case 'ble_rename_config': {
          const { id, name } = args as { id?: number; name?: string };
          if (!id || isNaN(Number(id)) || !name?.trim()) return text('错误: 需要 id 和 name。', true);
          db.renameSavedConfig(Number(id), name.trim());
          return text(`配置 #${id} 已重命名为「${name.trim()}」`);
        }

        case 'ble_delete_config': {
          const id = Number((args as { id?: number }).id);
          if (!id || isNaN(id)) return text('错误: 需要有效的配置 id。', true);
          db.deleteSavedConfig(id);
          return text(`配置 #${id} 已删除。剩余 ${db.countSavedConfigs()}/${db.SAVED_CONFIG_LIMIT} 条`);
        }

        // ── ble_set_interaction ────────────────────────────────────────────────
        case 'ble_set_interaction': {
          const ruleInput = args as unknown as InteractionRule;
          if (!ruleInput.id || !ruleInput.trigger || !ruleInput.action) {
            return text('错误: 需要提供 id、trigger 和 action 字段。', true);
          }
          const status = controller.getStatus();
          const base = status.config ?? db.getLatestSession()?.config ?? buildInitialConfig();
          const existingRules = base.interactionRules ?? [];
          const newRules = [...existingRules.filter((r) => r.id !== ruleInput.id), ruleInput];
          const cfg = mergeConfig(base, { interactionRules: newRules });
          if (status.state === 'running' && status.sessionId !== null) db.stopSession(status.sessionId);
          const sessionId = db.createSession(cfg, `交互规则更新: ${ruleInput.id}`);
          db.setKV('active_session_id', String(sessionId));
          if (status.state === 'running') {
            await controller.restart(cfg, sessionId);
            return text(`交互规则 "${ruleInput.id}" 已设置并热重启。Session ID: ${sessionId}`);
          }
          return text(`交互规则 "${ruleInput.id}" 已保存（模拟器未运行）。Session ID: ${sessionId}`);
        }

        // ── ble_clear_interactions ─────────────────────────────────────────────
        case 'ble_clear_interactions': {
          const status = controller.getStatus();
          const base = status.config ?? db.getLatestSession()?.config ?? buildInitialConfig();
          const cfg = mergeConfig(base, { interactionRules: [] });
          if (status.state === 'running' && status.sessionId !== null) db.stopSession(status.sessionId);
          const sessionId = db.createSession(cfg, '清除所有交互规则');
          db.setKV('active_session_id', String(sessionId));
          if (status.state === 'running') {
            await controller.restart(cfg, sessionId);
            return text(`已清除所有交互规则并热重启。Session ID: ${sessionId}`);
          }
          return text(`已清除所有交互规则（模拟器未运行）。Session ID: ${sessionId}`);
        }

        // ── ble_list_sessions ──────────────────────────────────────────────────
        case 'ble_list_sessions': {
          const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 50);
          const sessions = db.listSessions(limit);
          if (sessions.length === 0) return text('暂无历史会话记录。');
          const lines = sessions.map((s) =>
            `[${s.id}] ${s.startedAt} → ${s.stoppedAt ?? '运行中'} | ` +
            `类型: ${s.config.deviceType} | 设备: ${s.config.deviceInfo.deviceName}` +
            (s.notes ? ` | ${s.notes}` : ''),
          );
          return text(`共 ${sessions.length} 条记录（最近 ${limit} 条）：\n\n${lines.join('\n')}`);
        }

        // ── ble_get_session ────────────────────────────────────────────────────
        case 'ble_get_session': {
          const id = Number(input.id);
          if (!id || isNaN(id)) return text('错误: 需要提供有效的 session id。', true);
          const session = db.getSession(id);
          if (!session) return text(`未找到 session id=${id}。`);
          return text(
            `Session #${session.id}\n` +
            `开始: ${session.startedAt} | 结束: ${session.stoppedAt ?? '运行中'}\n` +
            `备注: ${session.notes ?? '—'}\n\n` +
            summarizeConfig(session.config),
          );
        }

        // ── ble_get_config ─────────────────────────────────────────────────────
        case 'ble_get_config': {
          const status = controller.getStatus();
          const cfg = status.config ?? db.getLatestSession()?.config;
          if (!cfg) return text('{}');
          return text(JSON.stringify(cfg, null, 2));
        }

        // ── ble_get_logs ───────────────────────────────────────────────────────
        case 'ble_get_logs': {
          const logsInput = args as {
            sessionId?: number;
            eventTypes?: LogEventType[];
            limit?: number;
            offset?: number;
            since?: string;
          } | undefined ?? {};

          const limit = Math.min(Math.max(Number(logsInput.limit ?? 50), 1), 1000);
          const offset = Math.max(Number(logsInput.offset ?? 0), 0);

          const logs = db.getLogs({
            sessionId: logsInput.sessionId !== undefined ? Number(logsInput.sessionId) : undefined,
            eventTypes: logsInput.eventTypes,
            limit,
            offset,
            since: logsInput.since,
          });
          const total = db.countLogs({
            sessionId: logsInput.sessionId !== undefined ? Number(logsInput.sessionId) : undefined,
            eventTypes: logsInput.eventTypes,
          });

          if (logs.length === 0) return text('暂无匹配的日志记录。');

          const header = [
            `共 ${total} 条日志，当前返回 ${logs.length} 条（offset=${offset}，limit=${limit}）`,
            logsInput.sessionId !== undefined ? `Session 过滤: #${logsInput.sessionId}` : '',
            logsInput.eventTypes?.length ? `事件类型过滤: ${logsInput.eventTypes.join(', ')}` : '',
            logsInput.since ? `时间起点: ${logsInput.since}` : '',
          ].filter(Boolean).join(' | ');

          const lines = logs.map((entry) => {
            const parts = [
              `[${entry.timestamp}]`,
              `#${entry.id}`,
              `session=${entry.sessionId ?? '—'}`,
              `[${entry.eventType}]`,
              entry.characteristicUuid ? `char=${entry.characteristicUuid}` : '',
              entry.dataHex ? `data=${entry.dataHex}` : '',
              entry.message,
            ].filter(Boolean);
            return parts.join('  ');
          });

          return text(`${header}\n\n${lines.join('\n')}`);
        }

        default:
          return text(`未知工具: ${name}`, true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return text(`操作失败: ${message}`, true);
    }
  });

  return server;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

export async function startMcpServer(
  controller: BleController,
  db: SimulatorDatabase,
  opts: McpServerOptions = {},
): Promise<void> {
  // ── Transport selection ──────────────────────────────────────────────────────
  const mode = opts.transport ?? 'stdio';

  if (mode === 'stdio') {
    const server = createServer(controller, db);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] BLE Simulator MCP server v2 started (stdio transport)');
    return;
  }

  // ── HTTP / Streamable HTTP transport (stateless, per-request) ─────────────
  // In stateless mode, StreamableHTTPServerTransport can only handle ONE request
  // per instance. A new Server + Transport must be created for every incoming
  // HTTP request, otherwise the second request throws:
  //   "Stateless transport cannot be reused across requests."
  // which @hono/node-server catches and returns as HTTP 500.
  const port = opts.port ?? 3300;
  const host = opts.host ?? '0.0.0.0';

  const httpServer = createHttpServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found — MCP endpoint is /mcp\n');
      return;
    }

    // Create a fresh Server + Transport pair for each request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    const server = createServer(controller, db);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      console.error(`[MCP] BLE Simulator MCP server v2 started (HTTP transport) — http://${host}:${port}/mcp`);
      resolve();
    });
  });
}