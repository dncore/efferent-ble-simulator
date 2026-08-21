/** 快捷模板：骑行动作模板 + 设备模板 */
export interface Tmpl {
  name: string;
  tag: string;
  desc: string;
  args: Record<string, unknown>;
}

const baseFtms = {
  speedKph: 25, cadenceRpm: 80, powerWatts: 150, baseHeartRate: 120, notifyIntervalMs: 500,
  resistanceLevel: 10, grade: 0, minResistance: 1, maxResistance: 100, minPower: 0, maxPower: 4000,
};

const baseSim = {
  enabled: true, riderWeightKg: 75, bikeWeightKg: 8, crr: 0.004, cdA: 0.35,
  cadenceCoupling: 'proportional' as const, microPauseProbability: 0.008, autoStart: true,
};

export const RIDE_TEMPLATES: Tmpl[] = [
  {
    name: '全程骑行剧本',
    tag: 'ride_script · 循环',
    desc: '起步→巡航→爬坡(5%)→冲刺→下坡滑行→停车，完整骑行体验，自动开始循环播放',
    args: { deviceType: 'ftms', ftms: { ...baseFtms, simulation: { ...baseSim, fatigueFactor: 0.0005, scenario: { type: 'ride_script', repeat: true } } } },
  },
  {
    name: 'FTP 测试',
    tag: 'ride_script',
    desc: '2min 起步 → 8min 热身 → 20min FTP 全力块 (280W) → 5min 冷却，经典 FTP 测试流程',
    args: {
      deviceType: 'ftms',
      ftms: {
        ...baseFtms, cadenceRpm: 85, powerWatts: 200, baseHeartRate: 130,
        simulation: {
          ...baseSim, fatigueFactor: 0, microPauseProbability: 0.002,
          scenario: { type: 'ride_script', repeat: false, phases: [
            { type: 'start', durationSeconds: 120, targetPower: 100, grade: 0, cadence: 80 },
            { type: 'cruise', durationSeconds: 480, targetPower: 150, grade: 0, cadence: 85 },
            { type: 'cruise', durationSeconds: 1200, targetPower: 280, grade: 0, cadence: 88 },
            { type: 'coast', durationSeconds: 300, targetPower: 100, grade: 0, cadence: 75 },
          ] },
        },
      },
    },
  },
  {
    name: '爬坡训练',
    tag: 'ride_script · 循环',
    desc: '爬坡 5min@6% → 下坡 5min@-4% → 更陡爬坡 5min@8%，两组循环，模拟爬坡日',
    args: {
      deviceType: 'ftms',
      ftms: {
        ...baseFtms, cadenceRpm: 75, powerWatts: 200, baseHeartRate: 125, resistanceLevel: 12,
        simulation: {
          ...baseSim, fatigueFactor: 0.001, cadenceCoupling: 'inverse', microPauseProbability: 0.002,
          scenario: { type: 'ride_script', repeat: true, phases: [
            { type: 'cruise', durationSeconds: 600, targetPower: 150, grade: 0, cadence: 85 },
            { type: 'climb', durationSeconds: 300, targetPower: 280, grade: 6, cadence: 72 },
            { type: 'coast', durationSeconds: 300, targetPower: 80, grade: -4, cadence: 60 },
            { type: 'climb', durationSeconds: 300, targetPower: 310, grade: 8, cadence: 70 },
            { type: 'coast', durationSeconds: 300, targetPower: 80, grade: -4, cadence: 60 },
          ] },
        },
      },
    },
  },
  {
    name: '冲刺间歇',
    tag: 'intervals · 8组',
    desc: '高强度 30s (1.5x) + 恢复 90s (0.5x)，8 组，经典 VO2max 冲刺间歇',
    args: {
      deviceType: 'ftms',
      ftms: {
        ...baseFtms, cadenceRpm: 85, powerWatts: 200, baseHeartRate: 130,
        simulation: {
          ...baseSim, fatigueFactor: 0.001, microPauseProbability: 0.001,
          scenario: { type: 'intervals', highPowerFactor: 1.5, lowPowerFactor: 0.5, intervalSeconds: 30, restSeconds: 90, sets: 8 },
        },
      },
    },
  },
  {
    name: '恢复骑行',
    tag: 'steady',
    desc: '稳定低强度 100W 巡航，配微停顿模拟放松踩踏，适合恢复日',
    args: {
      deviceType: 'ftms',
      ftms: {
        ...baseFtms, speedKph: 20, cadenceRpm: 70, powerWatts: 100, baseHeartRate: 100, resistanceLevel: 5,
        simulation: { ...baseSim, fatigueFactor: 0, cadenceCoupling: 'independent', microPauseProbability: 0.02, scenario: { type: 'steady' } },
      },
    },
  },
  {
    name: '热身-主课-冷却',
    tag: 'warmup_main_cooldown',
    desc: '5min 热身 (50→100%) → 20min 主课 (1.2x) → 5min 冷却，结构化训练课',
    args: {
      deviceType: 'ftms',
      ftms: {
        ...baseFtms, cadenceRpm: 82, powerWatts: 180,
        simulation: {
          ...baseSim, fatigueFactor: 0.001,
          scenario: { type: 'warmup_main_cooldown', warmupMinutes: 5, mainMinutes: 20, cooldownMinutes: 5, mainPowerFactor: 1.2 },
        },
      },
    },
  },
];

export const DEVICE_TEMPLATES: Tmpl[] = [
  {
    name: '心率计',
    tag: 'heart_rate',
    desc: '心率 75bpm 动态波动 + 电量模拟，手机健康 App 可连接',
    args: { deviceType: 'heart_rate', deviceInfo: { deviceName: 'HR_SIM' }, heartRate: { baseHeartRate: 75, initialBattery: 85, heartRateIntervalMs: 1000, bodySensorLocation: 2 } },
  },
  {
    name: '功率计',
    tag: 'cycling_power',
    desc: '功率 200W 动态波动 + 踏频 85rpm + 轮圈/曲柄数据',
    args: {
      deviceType: 'cycling_power', deviceInfo: { deviceName: 'POWER_SIM' },
      cyclingPower: {
        basePowerWatts: 200, cadenceRpm: 85, wheelCircumferenceMm: 2096, sensorLocation: 6,
        includeWheelRevData: true, includeCrankRevData: true, notifyIntervalMs: 1000,
        simulation: { enabled: true, riderWeightKg: 75, bikeWeightKg: 8, crr: 0.004, cdA: 0.35, cadenceCoupling: 'proportional', microPauseProbability: 0.005, scenario: { type: 'freeride' } },
      },
    },
  },
  {
    name: '速度/踏频',
    tag: 'csc',
    desc: '速度 25km/h + 踏频 80rpm，含轮速/曲柄事件',
    args: {
      deviceType: 'csc', deviceInfo: { deviceName: 'CSC_SIM' },
      csc: {
        speedKph: 25, cadenceRpm: 80, wheelCircumferenceMm: 2096, hasWheel: true, hasCrank: true, notifyIntervalMs: 1000,
        simulation: { enabled: true, riderWeightKg: 75, bikeWeightKg: 8, crr: 0.004, cdA: 0.35, cadenceCoupling: 'proportional', microPauseProbability: 0.005, scenario: { type: 'freeride' } },
      },
    },
  },
];
