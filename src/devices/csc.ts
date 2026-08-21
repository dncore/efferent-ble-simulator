/**
 * Cycling Speed & Cadence (CSC) Device — BLE Service 0x1816
 * Also covers dedicated cadence-only or speed-only sensors.
 */

import {
  BaseDevice, GattServiceInterface, ReadOnlyCharacteristicInterface,
  NotifyCharacteristicInterface, WritableCharacteristicInterface,
  buildDeviceInfoService,
} from './base';
import { SimulationConfig } from '../database';
import { CyclingSimulationEngine } from '../cycling-simulator';

const APP_PATH = '/org/openride';

export class CSCDevice extends BaseDevice {
  private speedKph: number;
  private cadenceRpm: number;
  private wheelCircMm: number;

  // Free-running counters (uint16, wrap naturally)
  private cumulativeWheelRevs = 0;
  private lastWheelEventTime = 0; // 1/1024 s ticks
  private cumulativeCrankRevs = 0;
  private lastCrankEventTime = 0; // 1/1024 s ticks

  private engine: CyclingSimulationEngine | null = null;

  private notifyChars: NotifyCharacteristicInterface[] = [];
  private writableChars: WritableCharacteristicInterface[] = [];
  private charMap = new Map<string, WritableCharacteristicInterface>();

  constructor(config: SimulationConfig) {
    super(config);
    const p = config.csc!;
    this.speedKph = p.speedKph;
    this.cadenceRpm = p.cadenceRpm;
    this.wheelCircMm = p.wheelCircumferenceMm;

    if (p.simulation?.enabled) {
      this.engine = new CyclingSimulationEngine(
        p.basePowerWatts ?? 150, p.cadenceRpm, p.simulation, p.notifyIntervalMs,
      );
    }

    this.build();
  }

  updateParams(speed?: number, cadence?: number): void {
    if (speed !== undefined) this.speedKph = speed;
    if (cadence !== undefined) this.cadenceRpm = cadence;
    if (this.engine && cadence !== undefined) {
      this.engine.updateBaseCadence(cadence);
    }
  }

  private buildMeasurement(): Buffer {
    const p = this.config.csc!;
    const interval = p.notifyIntervalMs / 1000;
    const TICKS = 1024;

    // 动态模拟：从引擎获取实时值
    let speed = this.speedKph;
    let cadence = this.cadenceRpm;
    if (this.engine) {
      const sim = this.engine.next(0);
      speed = sim.speedKph;
      cadence = sim.cadence;
    }

    let flags = 0;
    const parts: Buffer[] = [];

    if (p.hasWheel) {
      flags |= 0x01;
      const speedMs = speed / 3.6;
      const wheelCircM = this.wheelCircMm / 1000;
      const newRevs = (speedMs * interval) / wheelCircM;
      this.cumulativeWheelRevs = (this.cumulativeWheelRevs + newRevs) % 0x100000000;
      this.lastWheelEventTime = (this.lastWheelEventTime + Math.round(interval * TICKS)) & 0xFFFF;
      const wb = Buffer.alloc(6);
      wb.writeUInt32LE(Math.round(this.cumulativeWheelRevs) & 0xFFFFFFFF, 0);
      wb.writeUInt16LE(this.lastWheelEventTime, 4);
      parts.push(wb);
    }

    if (p.hasCrank) {
      flags |= 0x02;
      const crankRevPerSec = cadence / 60;
      this.cumulativeCrankRevs = (this.cumulativeCrankRevs + crankRevPerSec * interval) % 0x10000;
      this.lastCrankEventTime = (this.lastCrankEventTime + Math.round(interval * TICKS)) & 0xFFFF;
      const cb = Buffer.alloc(4);
      cb.writeUInt16LE(Math.round(this.cumulativeCrankRevs) & 0xFFFF, 0);
      cb.writeUInt16LE(this.lastCrankEventTime, 2);
      parts.push(cb);
    }

    const flagsBuf = Buffer.from([flags]);
    return Buffer.concat([flagsBuf, ...parts]);
  }

  private build(): void {
    const p = this.config.csc!;
    const info = this.config.deviceInfo;
    const svcPath = `${APP_PATH}/service0`;

    const cscService = new GattServiceInterface(svcPath, '1816');

    // 0x2A5B — CSC Measurement (notify)
    const measurement = new NotifyCharacteristicInterface({
      path: `${svcPath}/char0`, uuid: '2a5b', servicePath: svcPath,
      notifyIntervalMs: p.notifyIntervalMs,
      valueFactory: () => this.buildMeasurement(),
    });

    // 0x2A5C — CSC Feature (read)
    const feature = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char1`, uuid: '2a5c', servicePath: svcPath,
      valueFactory: () => {
        let feat = 0;
        if (p.hasWheel) feat |= 0x01;
        if (p.hasCrank) feat |= 0x02;
        const buf = Buffer.alloc(2);
        buf.writeUInt16LE(feat, 0);
        return buf;
      },
    });

    // 0x2A5D — Sensor Location (read)
    const sensorLoc = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char2`, uuid: '2a5d', servicePath: svcPath,
      valueFactory: () => Buffer.from([0x0D]), // Rear hub
    });

    // 0x2A55 — SC Control Point (write + indicate)
    const controlPoint = new WritableCharacteristicInterface({
      path: `${svcPath}/char3`, uuid: '2a55', servicePath: svcPath,
      flags: ['write', 'indicate'],
    });
    controlPoint.setWriteCallback((value) => {
      const opcode = value.readUInt8(0);
      const handled = this.applyInteractionRules('2a55', value, this.charMap);
      if (!handled) {
        if (opcode === 0x01) {
          // Set Cumulative Value — reset wheel revs
          if (value.length >= 5) {
            this.cumulativeWheelRevs = value.readUInt32LE(1);
          }
        }
        const resp = Buffer.alloc(3);
        resp.writeUInt8(0x10, 0); // Response Code
        resp.writeUInt8(opcode, 1);
        resp.writeUInt8(0x01, 2); // Success
        controlPoint.emitResponse(resp, true);
      }
      this.writeHandler?.('2a55', value);
    });
    this.charMap.set('2a55', controlPoint);

    const { nodes: infoNodes, entries: infoEntries } = buildDeviceInfoService(APP_PATH, 1, info);

    this.exportedNodes.push(
      { path: svcPath, iface: cscService },
      { path: `${svcPath}/char0`, iface: measurement },
      { path: `${svcPath}/char1`, iface: feature },
      { path: `${svcPath}/char2`, iface: sensorLoc },
      { path: `${svcPath}/char3`, iface: controlPoint },
      ...infoNodes,
    );
    this.managedEntries.push(cscService, measurement, feature, sensorLoc, controlPoint, ...infoEntries);
    this.notifyChars.push(measurement);
    this.writableChars.push(controlPoint);
  }

  stop(): void {
    for (const c of this.notifyChars) c.stop();
    for (const c of this.writableChars) c.stop();
  }

  /** 实时状态：引擎当前功率/踏频/速度（动态模拟开启时） */
  getLiveState(): Record<string, unknown> {
    if (!this.engine) return {};
    return {
      power: this.engine.currentPower,
      cadence: this.engine.currentCadence,
      speedKph: this.engine.currentSpeed,
    };
  }

  /** 原地热更新：速度/踏频 + 引擎配置 */
  applyConfig(config: SimulationConfig): void {
    const p = config.csc!;
    this.config = config;
    this.updateParams(p.speedKph, p.cadenceRpm);
    if (p.simulation?.enabled) {
      if (!this.engine) this.engine = new CyclingSimulationEngine(p.basePowerWatts ?? 150, p.cadenceRpm, p.simulation, p.notifyIntervalMs);
      else this.engine.updateConfig(p.simulation);
    } else {
      this.engine = null;
    }
  }

  static advertisedServiceUuids = ['1816'];
  static appearance = 0x0482; // Cycling Cadence Sensor
}
