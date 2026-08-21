/**
 * 配置工具函数
 */

import { randomBytes } from 'node:crypto';
import { SimulationConfig, DeviceType, CyclingSimulationConfig, buildDefaultConfig, DEFAULT_CYCLING_SIMULATION } from './database';

type InstanceIdMode = 'random' | 'timestamp' | 'fixed';

function resolveInstanceId(mode: InstanceIdMode): string {
  if (mode === 'timestamp') return Date.now().toString(36).toUpperCase();
  if (mode === 'fixed') {
    const fixed = process.env['SIM_INSTANCE_ID']?.trim();
    if (fixed) return fixed.toUpperCase();
  }
  return randomBytes(3).toString('hex').toUpperCase();
}

function resolveMode(raw: string | undefined): InstanceIdMode {
  const v = (raw ?? 'random').trim().toLowerCase();
  if (v === 'timestamp' || v === 'fixed') return v;
  return 'random';
}

/** 生成首次启动默认配置（含随机设备名） */
export function buildInitialConfig(deviceType: DeviceType = 'heart_rate'): SimulationConfig {
  const namePrefix = process.env['SIM_DEVICE_PREFIX']?.trim() || 'OPEN_RIDE';
  const idMode = resolveMode(process.env['SIM_INSTANCE_ID_MODE']);
  const instanceId = resolveInstanceId(idMode);
  const deviceName = `${namePrefix}_${instanceId}`;
  return buildDefaultConfig(deviceType, deviceName, instanceId);
}

/** 合并 simulation 子对象，包括 scenario 深合并；缺失字段回填默认值 */
function mergeSimulation(
  base: CyclingSimulationConfig | undefined,
  partial: Partial<CyclingSimulationConfig> | undefined,
): CyclingSimulationConfig | undefined {
  if (!partial) return base;
  // 先铺默认值再逐层覆盖，保证物理参数（riderWeightKg/crr/cdA 等）永不缺失，
  // 否则引擎会出现 NaN 速度（写入 Buffer 时静默变 0）
  const merged: CyclingSimulationConfig = {
    ...DEFAULT_CYCLING_SIMULATION,
    ...base,
    ...partial,
  };
  if (partial.scenario) {
    merged.scenario = {
      ...(base?.scenario ?? DEFAULT_CYCLING_SIMULATION.scenario),
      ...partial.scenario,
    };
  }
  return merged;
}

/** 深合并两个 SimulationConfig（partial 覆盖 base 中存在的字段） */
export function mergeConfig(base: SimulationConfig, partial: Partial<SimulationConfig>): SimulationConfig {
  return {
    ...base,
    ...partial,
    deviceInfo: { ...base.deviceInfo, ...(partial.deviceInfo ?? {}) },
    heartRate: partial.heartRate ? { ...base.heartRate, ...partial.heartRate } : base.heartRate,
    cyclingPower: partial.cyclingPower ? {
      ...base.cyclingPower, ...partial.cyclingPower,
      simulation: mergeSimulation(base.cyclingPower?.simulation, partial.cyclingPower.simulation),
    } : base.cyclingPower,
    csc: partial.csc ? {
      ...base.csc, ...partial.csc,
      simulation: mergeSimulation(base.csc?.simulation, partial.csc.simulation),
    } : base.csc,
    ftms: partial.ftms ? {
      ...base.ftms, ...partial.ftms,
      simulation: mergeSimulation(base.ftms?.simulation, partial.ftms.simulation),
    } : base.ftms,
    interactionRules: partial.interactionRules ?? base.interactionRules,
  };
}
