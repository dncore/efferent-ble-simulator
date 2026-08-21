/**
 * Heart Rate Monitor Device — BLE Service 0x180D
 */

import { Variant } from 'dbus-next';
import {
  BaseDevice, GattServiceInterface, ReadOnlyCharacteristicInterface,
  NotifyCharacteristicInterface, WritableCharacteristicInterface,
  buildDeviceInfoService, ExportedNode, ManagedEntry, Interface,
} from './base';
import { SimulationConfig, HeartRateParams } from '../database';
import { HeartRateSimulator, BatterySimulator } from '../simulator';

const APP_PATH = '/org/openride';

export class HeartRateDevice extends BaseDevice {
  private hrSim: HeartRateSimulator;
  private batSim: BatterySimulator;
  private notifyChars: (NotifyCharacteristicInterface | WritableCharacteristicInterface)[] = [];

  constructor(config: SimulationConfig) {
    super(config);
    const p = config.heartRate!;
    this.hrSim = new HeartRateSimulator(p.baseHeartRate);
    this.batSim = new BatterySimulator(p.initialBattery);
    this.build();
  }

  private build(): void {
    const p = this.config.heartRate!;
    const info = this.config.deviceInfo;
    const svcPath = `${APP_PATH}/service0`;
    const batSvcPath = `${APP_PATH}/service1`;

    // ── Heart Rate Service (0x180D) ───────────────────────────────────────────
    const hrService = new GattServiceInterface(svcPath, '180d');

    const hrMeasurement = new NotifyCharacteristicInterface({
      path: `${svcPath}/char0`, uuid: '2a37', servicePath: svcPath,
      notifyIntervalMs: p.heartRateIntervalMs,
      valueFactory: () => {
        const hr = this.hrSim.next();
        const buf = Buffer.alloc(2);
        buf.writeUInt8(0b00000110, 0); // flags: uint8 format, sensor contact detected
        buf.writeUInt8(hr, 1);
        return buf;
      },
    });

    const bodySensor = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char1`, uuid: '2a38', servicePath: svcPath,
      valueFactory: () => Buffer.from([p.bodySensorLocation]),
    });

    // ── Battery Service (0x180F) ──────────────────────────────────────────────
    const batService = new GattServiceInterface(batSvcPath, '180f');
    const batLevel = new NotifyCharacteristicInterface({
      path: `${batSvcPath}/char0`, uuid: '2a19', servicePath: batSvcPath,
      notifyIntervalMs: 60_000,
      valueFactory: () => Buffer.from([this.batSim.next()]),
    });

    // ── Device Info Service ───────────────────────────────────────────────────
    const { nodes: infoNodes, entries: infoEntries } = buildDeviceInfoService(APP_PATH, 2, info);

    // ── Assemble ──────────────────────────────────────────────────────────────
    this.exportedNodes.push(
      { path: svcPath, iface: hrService },
      { path: `${svcPath}/char0`, iface: hrMeasurement },
      { path: `${svcPath}/char1`, iface: bodySensor },
      { path: batSvcPath, iface: batService },
      { path: `${batSvcPath}/char0`, iface: batLevel },
      ...infoNodes,
    );
    this.managedEntries.push(
      hrService, hrMeasurement, bodySensor,
      batService, batLevel,
      ...infoEntries,
    );
    this.notifyChars.push(hrMeasurement, batLevel);
  }

  stop(): void {
    for (const c of this.notifyChars) c.stop();
  }

  /** 实时状态：当前心率 */
  getLiveState(): Record<string, unknown> {
    return { heartRate: Math.round(this.hrSim.value) };
  }

  /** 原地热更新：心率基准（电量/通知间隔等结构性参数仍需重启） */
  applyConfig(config: SimulationConfig): void {
    const p = config.heartRate!;
    this.config = config;
    this.hrSim.updateBase(p.baseHeartRate);
  }

  /** Advertisement service UUIDs */
  static advertisedServiceUuids = ['180d'];
  static appearance = 0x0340; // Heart Rate Sensor
}
