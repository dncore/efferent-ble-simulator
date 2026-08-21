/**
 * Fitness Machine Service (FTMS) Device — BLE Service 0x1826
 * Simulates a smart trainer / cycling trainer.
 */

import {
  BaseDevice, GattServiceInterface, ReadOnlyCharacteristicInterface,
  NotifyCharacteristicInterface, WritableCharacteristicInterface,
  buildDeviceInfoService, Interface,
} from './base';
import { SimulationConfig } from '../database';
import { CyclingSimulationEngine } from '../cycling-simulator';
import { HeartRateSimulator } from '../simulator';

const APP_PATH = '/org/openride';

type MachineState = 'idle' | 'running' | 'paused';

export class FTMSDevice extends BaseDevice {
  private speedKph: number;
  private cadenceRpm: number;
  private powerWatts: number;
  private resistanceLevel: number;
  private grade: number;
  private elapsedSeconds = 0;
  private totalKcal = 0;
  private machineState: MachineState = 'idle';
  private hasControl = false;

  private engine: CyclingSimulationEngine | null = null;
  private hrSim: HeartRateSimulator | null = null;

  private notifyChars: (NotifyCharacteristicInterface | WritableCharacteristicInterface)[] = [];
  private writableChars: WritableCharacteristicInterface[] = [];
  private charMap = new Map<string, WritableCharacteristicInterface>();
  private statusChar: WritableCharacteristicInterface | null = null;

  constructor(config: SimulationConfig) {
    super(config);
    const p = config.ftms!;
    this.speedKph = p.speedKph;
    this.cadenceRpm = p.cadenceRpm;
    this.powerWatts = p.powerWatts;
    this.resistanceLevel = p.resistanceLevel;
    this.grade = p.grade;

    if (p.simulation?.enabled) {
      this.engine = new CyclingSimulationEngine(
        p.powerWatts, p.cadenceRpm, p.simulation, p.notifyIntervalMs,
      );
      // 骑行剧本场景默认自动开始；其他场景可用 autoStart: true 显式开启
      if (p.simulation.autoStart ?? p.simulation.scenario.type === 'ride_script') {
        this.machineState = 'running';
      }
    }

    // 心率模拟器：baseHeartRate > 0 时启用动态心率
    if (p.baseHeartRate > 0) {
      this.hrSim = new HeartRateSimulator(p.baseHeartRate);
    }

    this.build();
  }

  updateParams(opts: { speed?: number; cadence?: number; power?: number; resistance?: number; grade?: number }): void {
    if (opts.speed !== undefined) this.speedKph = opts.speed;
    if (opts.cadence !== undefined) this.cadenceRpm = opts.cadence;
    if (opts.power !== undefined) this.powerWatts = opts.power;
    if (opts.resistance !== undefined) this.resistanceLevel = opts.resistance;
    if (opts.grade !== undefined) this.grade = opts.grade;
    // 同步更新引擎基准
    if (this.engine) {
      if (opts.power !== undefined) this.engine.updateBasePower(opts.power);
      if (opts.cadence !== undefined) this.engine.updateBaseCadence(opts.cadence);
    }
  }

  private buildIndoorBikeData(): Buffer {
    // 动态模拟：从引擎获取实时值
    let speed = this.speedKph;
    let cadence = this.cadenceRpm;
    let power = this.powerWatts;
    let heartRate = this.hrSim ? this.hrSim.value : 0;

    if (this.engine && this.machineState === 'running') {
      const sim = this.engine.next(this.grade);
      speed = sim.speedKph;
      cadence = sim.cadence;
      power = sim.power;
    }

    // 心率模拟器在 running 状态时推进 tick
    if (this.hrSim && this.machineState === 'running') {
      heartRate = this.hrSim.next();
    }

    if (this.machineState === 'running') {
      this.elapsedSeconds++;
      this.totalKcal += (power * (1 / 3600)); // rough kcal accumulation
    }

    // flags: bit0(speed), bit2(cadence), bit6(power), bit8(energy), bit10(hr), bit11(elapsed)
    const hasHr = this.hrSim !== null;
    const flags = hasHr ? 0x0D44 : 0x0944; // bit10 = heart rate
    const buf = Buffer.alloc(20);
    let off = 0;
    buf.writeUInt16LE(flags, off); off += 2;
    buf.writeUInt16LE(Math.round(speed * 100), off); off += 2;               // 0.01 km/h
    buf.writeUInt16LE(Math.round(cadence * 2), off); off += 2;               // 0.5 rpm
    buf.writeInt16LE(Math.round(power), off); off += 2;                       // 1 W
    buf.writeUInt16LE(Math.min(0xFFFF, Math.round(this.totalKcal)), off); off += 2;             // kcal total（UInt16 钳制防溢出）
    buf.writeUInt16LE(0xFFFF, off); off += 2;                                 // kcal/h N/A
    buf.writeUInt8(0xFF, off); off += 1;                                       // kcal/min N/A
    if (hasHr) {
      buf.writeUInt8(Math.min(255, Math.round(heartRate)), off); off += 1;   // bpm
    }
    buf.writeUInt16LE(Math.min(0xFFFF, this.elapsedSeconds), off); off += 2;  // elapsed s（UInt16 钳制防溢出）
    return buf.subarray(0, off);
  }

  private handleControlPoint(value: Buffer, controlPoint: WritableCharacteristicInterface): void {
    const opcode = value.readUInt8(0);

    const respond = (reqOp: number, result: number): void => {
      const resp = Buffer.alloc(3);
      resp.writeUInt8(0x80, 0); // Response Code
      resp.writeUInt8(reqOp, 1);
      resp.writeUInt8(result, 2);
      controlPoint.emitResponse(resp, true);
    };

    const emitStatus = (statusOpcode: number, param?: Buffer): void => {
      if (!this.statusChar) return;
      const buf = param ? Buffer.concat([Buffer.from([statusOpcode]), param]) : Buffer.from([statusOpcode]);
      this.statusChar.emitResponse(buf);
    };

    // Check interaction rules first
    const handled = this.applyInteractionRules('2ad9', value, this.charMap);
    if (handled) {
      this.writeHandler?.('2ad9', value);
      return;
    }

    switch (opcode) {
      case 0x00: // Request Control
        this.hasControl = true;
        respond(0x00, 0x01);
        break;

      case 0x01: // Reset
        this.machineState = 'idle';
        this.elapsedSeconds = 0;
        this.totalKcal = 0;
        this.engine?.reset();
        respond(0x01, 0x01);
        emitStatus(0x01);
        break;

      case 0x04: // Set Target Resistance Level (sint16 LE, unit 0.1)
        if (!this.hasControl) { respond(opcode, 0x05); break; }
        if (value.length >= 3) {
          this.resistanceLevel = value.readInt16LE(1) / 10;
          respond(0x04, 0x01);
          const p = Buffer.alloc(2); p.writeInt16LE(Math.round(this.resistanceLevel * 10), 0);
          emitStatus(0x07, p);
        } else { respond(0x04, 0x03); }
        break;

      case 0x05: // Set Target Power (sint16 LE, unit 1 W)
        if (!this.hasControl) { respond(opcode, 0x05); break; }
        if (value.length >= 3) {
          this.powerWatts = value.readInt16LE(1);
          this.engine?.updateBasePower(this.powerWatts);
          respond(0x05, 0x01);
          const p = Buffer.alloc(2); p.writeInt16LE(this.powerWatts, 0);
          emitStatus(0x08, p);
        } else { respond(0x05, 0x03); }
        break;

      case 0x07: // Start or Resume
        if (!this.hasControl) { respond(opcode, 0x05); break; }
        this.machineState = 'running';
        respond(0x07, 0x01);
        emitStatus(0x04);
        break;

      case 0x08: // Stop or Pause
        if (!this.hasControl) { respond(opcode, 0x05); break; }
        if (value.length >= 2) {
          const param = value.readUInt8(1);
          this.machineState = param === 0x01 ? 'idle' : 'paused';
          respond(0x08, 0x01);
          emitStatus(0x02, Buffer.from([param]));
        } else { respond(0x08, 0x03); }
        break;

      case 0x11: // Set Indoor Bike Simulation Parameters
        if (!this.hasControl) { respond(opcode, 0x05); break; }
        if (value.length >= 7) {
          // windSpeed sint16 0.001 m/s, grade sint16 0.01%, crr uint8 0.0001, cw uint8 0.01
          this.grade = value.readInt16LE(3) / 100;
          respond(0x11, 0x01);
          const p = Buffer.alloc(6);
          value.copy(p, 0, 1, 7);
          emitStatus(0x12, p);
        } else { respond(0x11, 0x03); }
        break;

      default:
        respond(opcode, 0x02); // Op Code Not Supported
        break;
    }

    this.writeHandler?.('2ad9', value);
    // Re-grant control is lost on each new session
  }

  private build(): void {
    const p = this.config.ftms!;
    const info = this.config.deviceInfo;
    const svcPath = `${APP_PATH}/service0`;

    const ftmsService = new GattServiceInterface(svcPath, '1826');

    // 0x2ACC — Fitness Machine Feature (read, 8 bytes)
    const feature = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char0`, uuid: '2acc', servicePath: svcPath,
      valueFactory: () => {
        const buf = Buffer.alloc(8);
        // Features: cadence(1) + distance(2) + resistance(7) + power(14) + HR(10) + energy(9) + elapsed(12)
        buf.writeUInt32LE(0x00005CC2, 0);
        // Target settings: resistance(2) + power(3) + HR(4) + sim params(13)
        buf.writeUInt32LE(0x00002018, 4);
        return buf;
      },
    });

    // 0x2AD2 — Indoor Bike Data (notify)
    const indoorBikeData = new NotifyCharacteristicInterface({
      path: `${svcPath}/char1`, uuid: '2ad2', servicePath: svcPath,
      notifyIntervalMs: p.notifyIntervalMs,
      valueFactory: () => this.buildIndoorBikeData(),
    });

    // 0x2AD9 — Fitness Machine Control Point (write + indicate)
    const controlPoint = new WritableCharacteristicInterface({
      path: `${svcPath}/char2`, uuid: '2ad9', servicePath: svcPath,
      flags: ['write', 'indicate'],
    });
    controlPoint.setWriteCallback((value) => this.handleControlPoint(value, controlPoint));
    this.charMap.set('2ad9', controlPoint);

    // 0x2ADA — Fitness Machine Status (notify, event-driven)
    // 初始状态：autoStart/running 时报告“已启动”，否则“重置”
    const status = new WritableCharacteristicInterface({
      path: `${svcPath}/char3`, uuid: '2ada', servicePath: svcPath,
      flags: ['notify'],
      initialValue: Buffer.from([this.machineState === 'running' ? 0x04 : 0x01]), // 0x04=Started, 0x01=Reset
    });
    this.statusChar = status;
    this.charMap.set('2ada', status);

    // 0x2AD6 — Supported Resistance Level Range (read)
    const resistanceRange = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char4`, uuid: '2ad6', servicePath: svcPath,
      valueFactory: () => {
        const buf = Buffer.alloc(6);
        buf.writeInt16LE(Math.round(p.minResistance * 10), 0);
        buf.writeInt16LE(Math.round(p.maxResistance * 10), 2);
        buf.writeUInt16LE(10, 4); // step = 1.0
        return buf;
      },
    });

    // 0x2AD8 — Supported Power Range (read)
    const powerRange = new ReadOnlyCharacteristicInterface({
      path: `${svcPath}/char5`, uuid: '2ad8', servicePath: svcPath,
      valueFactory: () => {
        const buf = Buffer.alloc(6);
        buf.writeInt16LE(p.minPower, 0);
        buf.writeInt16LE(p.maxPower, 2);
        buf.writeUInt16LE(1, 4); // 1 W step
        return buf;
      },
    });

    const { nodes: infoNodes, entries: infoEntries } = buildDeviceInfoService(APP_PATH, 1, info);

    this.exportedNodes.push(
      { path: svcPath, iface: ftmsService },
      { path: `${svcPath}/char0`, iface: feature },
      { path: `${svcPath}/char1`, iface: indoorBikeData },
      { path: `${svcPath}/char2`, iface: controlPoint },
      { path: `${svcPath}/char3`, iface: status },
      { path: `${svcPath}/char4`, iface: resistanceRange },
      { path: `${svcPath}/char5`, iface: powerRange },
      ...infoNodes,
    );
    this.managedEntries.push(
      ftmsService, feature, indoorBikeData, controlPoint, status, resistanceRange, powerRange,
      ...infoEntries,
    );
    this.notifyChars.push(indoorBikeData);
    this.writableChars.push(controlPoint, status);
  }

  stop(): void {
    this.machineState = 'idle';
    this.hasControl = false;
    for (const c of this.notifyChars) c.stop();
    for (const c of this.writableChars) c.stop();
  }

  /** 实时状态：运行状态/场景/阶段/功率/踏频/速度/心率/已骑行时长 */
  getLiveState(): Record<string, unknown> {
    const state: Record<string, unknown> = {
      machineState: this.machineState,
      elapsedSeconds: this.elapsedSeconds,
    };
    if (this.engine) {
      state.scenario = this.config.ftms?.simulation?.scenario?.type;
      state.phase = this.engine.currentPhaseType ?? undefined;
      state.grade = this.engine.currentGrade ?? this.grade;
      state.power = this.engine.currentPower;
      state.cadence = this.engine.currentCadence;
      state.speedKph = this.engine.currentSpeed;
    }
    if (this.hrSim) state.heartRate = Math.round(this.hrSim.value);
    return state;
  }

  /** 原地热更新：基础参数 + 心率 + 引擎/场景，保持中心连接实时生效 */
  applyConfig(config: SimulationConfig): void {
    const p = config.ftms!;
    this.config = config;
    this.updateParams({
      speed: p.speedKph, cadence: p.cadenceRpm, power: p.powerWatts,
      resistance: p.resistanceLevel, grade: p.grade,
    });
    // 心率基准
    if (p.baseHeartRate > 0) {
      if (!this.hrSim) this.hrSim = new HeartRateSimulator(p.baseHeartRate);
      else this.hrSim.updateBase(p.baseHeartRate);
    } else {
      this.hrSim = null;
    }
    // 引擎/场景热更新（新配置自动开始：ride_script 默认、autoStart 显式）
    if (p.simulation?.enabled) {
      if (!this.engine) {
        this.engine = new CyclingSimulationEngine(p.powerWatts, p.cadenceRpm, p.simulation, p.notifyIntervalMs);
        if (p.simulation.autoStart ?? p.simulation.scenario.type === 'ride_script') this.machineState = 'running';
      } else {
        this.engine.updateConfig(p.simulation);
      }
    } else {
      this.engine = null;
    }
  }

  static advertisedServiceUuids = ['1826'];
  static appearance = 0x0480; // Generic Cycling
}
