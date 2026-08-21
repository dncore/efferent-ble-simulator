/** 设备/模拟/场景表单字段定义 + 常量映射 */

export interface FieldDef {
  key: string;
  label: string;
  type: 'number' | 'bool' | 'select';
  def: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export type DeviceType = 'ftms' | 'heart_rate' | 'cycling_power' | 'csc';

export const DEVICE_SCHEMAS: Record<DeviceType, FieldDef[]> = {
  heart_rate: [
    { key: 'baseHeartRate', label: '基准心率 (bpm)', type: 'number', def: 75, min: 40, max: 200 },
    { key: 'initialBattery', label: '初始电量 (%)', type: 'number', def: 85, min: 0, max: 100 },
    { key: 'heartRateIntervalMs', label: '通知间隔 (ms)', type: 'number', def: 1000, min: 100, max: 10000 },
    { key: 'bodySensorLocation', label: '佩戴位置 (0-6)', type: 'number', def: 2, min: 0, max: 6 },
  ],
  cycling_power: [
    { key: 'basePowerWatts', label: '基准功率 (W)', type: 'number', def: 150, min: 0, max: 5000 },
    { key: 'cadenceRpm', label: '踏频 (rpm)', type: 'number', def: 80, min: 0, max: 200 },
    { key: 'wheelCircumferenceMm', label: '轮周长 (mm)', type: 'number', def: 2096, min: 500, max: 3000 },
    { key: 'sensorLocation', label: '传感器位置', type: 'number', def: 6, min: 0, max: 16 },
    { key: 'includeWheelRevData', label: '包含轮圈数据', type: 'bool', def: true },
    { key: 'includeCrankRevData', label: '包含曲柄数据', type: 'bool', def: true },
    { key: 'notifyIntervalMs', label: '通知间隔 (ms)', type: 'number', def: 1000, min: 100, max: 10000 },
  ],
  csc: [
    { key: 'speedKph', label: '速度 (km/h)', type: 'number', def: 25, min: 0, max: 150 },
    { key: 'cadenceRpm', label: '踏频 (rpm)', type: 'number', def: 80, min: 0, max: 200 },
    { key: 'wheelCircumferenceMm', label: '轮周长 (mm)', type: 'number', def: 2096, min: 500, max: 3000 },
    { key: 'hasWheel', label: '含轮速', type: 'bool', def: true },
    { key: 'hasCrank', label: '含踏频', type: 'bool', def: true },
    { key: 'notifyIntervalMs', label: '通知间隔 (ms)', type: 'number', def: 1000, min: 100, max: 10000 },
  ],
  ftms: [
    { key: 'speedKph', label: '速度 (km/h)', type: 'number', def: 25, min: 0, max: 120 },
    { key: 'cadenceRpm', label: '踏频 (rpm)', type: 'number', def: 80, min: 0, max: 200 },
    { key: 'powerWatts', label: '功率 (W)', type: 'number', def: 150, min: 0, max: 2000 },
    { key: 'baseHeartRate', label: '基准心率 (bpm, 0=关闭)', type: 'number', def: 120, min: 0, max: 220 },
    { key: 'notifyIntervalMs', label: '通知间隔 (ms)', type: 'number', def: 500, min: 100, max: 10000 },
    { key: 'resistanceLevel', label: '阻力等级', type: 'number', def: 10, min: 1, max: 100 },
    { key: 'grade', label: '坡度 (%)', type: 'number', def: 0, min: -15, max: 20 },
    { key: 'minResistance', label: '最小阻力', type: 'number', def: 1 },
    { key: 'maxResistance', label: '最大阻力', type: 'number', def: 100 },
    { key: 'minPower', label: '最小功率', type: 'number', def: 0 },
    { key: 'maxPower', label: '最大功率', type: 'number', def: 4000 },
  ],
};

export const SIM_SCHEMA: FieldDef[] = [
  { key: 'enabled', label: '启用动态模拟', type: 'bool', def: true },
  { key: 'riderWeightKg', label: '骑手体重 (kg)', type: 'number', def: 75, min: 30, max: 200 },
  { key: 'bikeWeightKg', label: '车重 (kg)', type: 'number', def: 8, min: 3, max: 25 },
  { key: 'crr', label: '滚动阻力', type: 'number', def: 0.004, step: 0.001, min: 0.001, max: 0.01 },
  { key: 'cdA', label: '风阻系数 (m²)', type: 'number', def: 0.35, step: 0.01, min: 0.1, max: 1 },
  { key: 'fatigueFactor', label: '疲劳衰减', type: 'number', def: 0.0005, step: 0.0001, min: 0, max: 0.01 },
  { key: 'cadenceCoupling', label: '踏频耦合', type: 'select', def: 'proportional', options: ['proportional', 'inverse', 'independent'] },
  { key: 'microPauseProbability', label: '微停顿概率', type: 'number', def: 0.008, step: 0.001, min: 0, max: 0.05 },
  { key: 'autoStart', label: '自动开始骑行', type: 'bool', def: true },
];

export const SCENARIO_TYPES = [
  { value: 'ride_script', label: 'ride_script 骑行剧本' },
  { value: 'steady', label: 'steady 平稳' },
  { value: 'freeride', label: 'freeride 自由骑' },
  { value: 'intervals', label: 'intervals 间歇' },
  { value: 'warmup_main_cooldown', label: 'warmup_main_cooldown 热身-主课-冷却' },
];

export const PHASE_MAP: Record<string, string> = {
  start: '起步', cruise: '巡航', climb: '爬坡', sprint: '冲刺', coast: '滑行', stop: '停车',
};

export const STATE_MAP: Record<string, string> = { running: '骑行中', paused: '已暂停', idle: '未开始' };

export const EVT_PRESETS: Record<string, string[] | undefined> = {
  key: ['simulator_start', 'simulator_stop', 'central_connected', 'central_disconnected', 'write_received', 'indicate_sent', 'param_updated', 'error'],
  all: undefined,
  conn: ['central_connected', 'central_disconnected'],
  write: ['write_received'],
  startstop: ['simulator_start', 'simulator_stop'],
  notify: ['notify_sent'],
  error: ['error'],
};

export const EVT_LABELS: Record<string, string> = {
  key: '关键事件', all: '全部事件', conn: '连接/断开', write: '控制指令',
  startstop: '启动/停止', notify: '数据推送', error: '错误',
};

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  ftms: 'FTMS 骑行台 (0x1826)',
  heart_rate: '心率计 (0x180D)',
  cycling_power: '功率计 (0x1818)',
  csc: '速度/踏频 (0x1816)',
};
