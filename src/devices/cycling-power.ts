/**
 * Cycling Power Meter Device — BLE Service 0x1818
 */

import {
  BaseDevice, GattServiceInterface, ReadOnlyCharacteristicInterface,
  NotifyCharacteristicInterface, WritableCharacteristicInterface,
  buildDeviceInfoService, Interface,
} from './base';
import { SimulationConfig } from '../database';
import { CyclingSimulationEngine } from '../cycling-simulator';

const APP_PATH = '/org/openride';

export class CyclingPowerDevice extends BaseDevice {
  // Simulation state
  private power: number;
  private cadenceRpm: number;
  private wheelCircMm: number;
  private cumulativeWheelRevs = 0;
  private lastWheelEventTime = 0;   // unit: 1/2048 s, wraps uint16
  private cumulativeCrankRevs = 0;
  private lastCrankEventTime = 0;   // unit: 1/1024 s, wraps uint16

  private engine: CyclingSimulationEngine | null = null;

  private notifyChars: NotifyCharacteristicInterface[] = [];
  private writableChars: WritableCharacteristicInterface[] = [];
  private charMap = new Map<string, WritableCharacteristicInterface>();

  constructor(config: SimulationConfig) {
    super(config);
    const p = config.cyclingPower!;
    this.power = p.basePowerWatts;
    this.cadenceRpm = p.cadenceRpm;
    this.wheelCircMm = p.wheelCircumferenceMm;

    if (p.simulation?.enabled) {
      this.engine = new CyclingSimulationEngine(
        p.basePowerWatts, p.cadenceRpm, p.simulation, p.notifyIntervalMs,
      );
    }

    this.build();
  }

  /** Called by BleController to update live params */
  updateParams(power?: number, cadence?: number): void {
    if (power !== undefined) this.power = power;
    if (cadence !== undefined) this.cadenceRpm = cadence;
    if (this.engine) {
      if (power !== undefined) this.engine.updateBasePower(power);
      if (cadence !== undefined) this.engine.updateBaseCadence(cadence);
    }
  }

  private buildMeasurement(): Buffer {
    const p = this.config.cyclingPower!;
    const interval = p.notifyIntervalMs / 1000; // seconds per tick

    // 动态模拟：从引擎获取实时值
    let power = this.power;
    let cadence = this.cadenceRpm;
    if (this.engine) {
      const sim = this.engine.next(0); // 功率计无坡度信息
      power = sim.power;
      cadence = sim.cadence;
    }

    let flags = 0x0000;
    const parts: Buffer[] = [];

    // Instantaneous power (always present, sint16 LE)
    const powerBuf = Buffer.alloc(2);
    powerBuf.writeInt16LE(Math.round(power), 0);
    parts.push(powerBuf);

    // Wheel revolution data
    if (p.includeWheelRevData) {
      flags |= 0x0010;
      const wheelRevPerSec = (power / 80) * (cadence / 80); // rough simulation
      const newRevs = wheelRevPerSec * interval;
      this.cumulativeWheelRevs += newRevs;
      this.lastWheelEventTime = (this.lastWheelEventTime + Math.round(interval * 2048)) & 0xFFFF;
      const wb = Buffer.alloc(6);
      wb.writeUInt32LE(Math.round(this.cumulativeWheelRevs) & 0xFFFFFFFF, 0);
      wb.writeUInt16LE(this.lastWheelEventTime, 4);
      parts.push(wb);
    }

    // Crank revolution data
    if (p.includeCrankRevData) {
      flags |= 0x0020;
      const crankRevPerSec = cadence / 60;
      this.cumulativeCrankRevs += crankRevPerSec * interval;
      this.lastCrankEventTime = (this.lastCrankEventTime + Math.round(interval * 1024)) & 0xFFFF;
      const cb = Buffer.alloc(4);
      cb.writeUInt16LE(Math.round(this.cumulativeCrankRevs) & 0xFFFF, 0);
      cb.writeUInt16LE(this.lastCrankEventTime, 2);
      parts.push(cb);
    }

    const flagsBuf = Buffer.alloc(2);
    flagsBuf.writeUInt16LE(flags, 0);
    return Buffer.concat([flagsBuf, ...parts]);
  }

  private build(): void {
    const p = this.config.cyclingPower!;
    const info = this.config.deviceInfo;
    const svcPath = `${APP_PATH}/service0`;

    // ── Cycling Power Service (0x1818) ────────────────────────────────────────
    const cpService = new GattServiceInterface(svcPath, '1818');

    // 0x2A63 — Power Measurement (notify)
    const measurement = new NotifyCharacteristicInterface({
      path: `${svcPath}/char0`, uuid: '2a63', servicePath: svcPath,
      notifyIntervalMs: p.notifyIntervalMs,
      valueFactory: () => this.buildMeasurement(),
    });

    // 0x2A65 — Cycling Power Feature (read) — wheel+crank+offset supported
    const feature = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char1`, uuid: '2a65', servicePath: svcPath,
      valueFactory: () => {
        const buf = Buffer.alloc(4);
        let feat = 0;
        if (p.includeWheelRevData) feat |= 0x04;
        if (p.includeCrankRevData) feat |= 0x08;
        buf.writeUInt32LE(feat, 0);
        return buf;
      },
    });

    // 0x2A5D — Sensor Location (read)
    const sensorLoc = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char2`, uuid: '2a5d', servicePath: svcPath,
      valueFactory: () => Buffer.from([p.sensorLocation]),
    });

    // 0x2A66 — Cycling Power Control Point (write + indicate)
    const controlPoint = new WritableCharacteristicInterface({
      path: `${svcPath}/char3`, uuid: '2a66', servicePath: svcPath,
      flags: ['write', 'indicate'],
    });
    controlPoint.setWriteCallback((value) => {
      const opcode = value.readUInt8(0);
      // Apply interaction rules first
      const handled = this.applyInteractionRules('2a66', value, this.charMap);
      if (!handled) {
        // Default: respond Success to all opcodes
        const resp = Buffer.alloc(3);
        resp.writeUInt8(0x20, 0); // Response Code
        resp.writeUInt8(opcode, 1);
        resp.writeUInt8(0x01, 2); // Success
        controlPoint.emitResponse(resp, true);
      }
      this.writeHandler?.('2a66', value);
    });
    this.charMap.set('2a66', controlPoint);

    // ── Device Info Service ───────────────────────────────────────────────────
    const { nodes: infoNodes, entries: infoEntries } = buildDeviceInfoService(APP_PATH, 1, info);

    // ── Assemble ──────────────────────────────────────────────────────────────
    this.exportedNodes.push(
      { path: svcPath, iface: cpService },
      { path: `${svcPath}/char0`, iface: measurement },
      { path: `${svcPath}/char1`, iface: feature },
      { path: `${svcPath}/char2`, iface: sensorLoc },
      { path: `${svcPath}/char3`, iface: controlPoint },
      ...infoNodes,
    );
    this.managedEntries.push(cpService, measurement, feature, sensorLoc, controlPoint, ...infoEntries);
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

  /** 原地热更新：基础功率/踏频 + 引擎配置 */
  applyConfig(config: SimulationConfig): void {
    const p = config.cyclingPower!;
    this.config = config;
    this.updateParams(p.basePowerWatts, p.cadenceRpm);
    if (p.simulation?.enabled) {
      if (!this.engine) this.engine = new CyclingSimulationEngine(p.basePowerWatts, p.cadenceRpm, p.simulation, p.notifyIntervalMs);
      else this.engine.updateConfig(p.simulation);
    } else {
      this.engine = null;
    }
  }

  static advertisedServiceUuids = ['1818'];
  static appearance = 0x0480; // Cycling Power Sensor
}
