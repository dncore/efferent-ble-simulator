/**
 * BaseDevice — 所有 BLE 设备模拟的抽象基类
 *
 * 定义统一的设备接口，每种设备类型继承此类并实现具体的 GATT 服务结构。
 * BleController 通过此接口操作所有设备，无需关心具体设备类型。
 */

import { Variant, interface as dbusInterface } from 'dbus-next';
import { InteractionRule, SimulationConfig } from '../database';

const { Interface } = dbusInterface;

// ─── D-Bus Object Types (re-exported for device implementations) ──────────────

export { Interface };
export type ExportableInterface = dbusInterface.Interface;
export const ACCESS_READ = dbusInterface.ACCESS_READ;
export const ACCESS_WRITE = dbusInterface.ACCESS_WRITE;

// ─── Managed Object types ─────────────────────────────────────────────────────

export type ManagedObjects = Record<string, Record<string, Record<string, Variant>>>;

export interface ManagedEntry {
  path: string;
  interfaceName: string;
  properties(): Record<string, Variant>;
}

export interface ExportedNode {
  path: string;
  iface: ExportableInterface;
}

// ─── Write handler type ───────────────────────────────────────────────────────

export type WriteHandler = (characteristicUuid: string, value: Buffer) => void;

// ─── Data sent handler type ───────────────────────────────────────────────────

/** 当设备向已订阅的中心设备发出 notify/indicate 数据时触发 */
export type DataSentHandler = (characteristicUuid: string, value: Buffer) => void;

// ─── Connection event handler type ───────────────────────────────────────────

export type ConnectionEventHandler = (
  event: 'central_connected' | 'central_disconnected',
  characteristicUuid: string,
) => void;

// ─── BaseDevice ───────────────────────────────────────────────────────────────

export abstract class BaseDevice {
  protected config: SimulationConfig;
  protected writeHandler: WriteHandler | null = null;
  protected connectionEventHandler: ConnectionEventHandler | null = null;
  protected dataSentHandler: DataSentHandler | null = null;

  /** 所有需要 export 到 D-Bus 的节点 */
  readonly exportedNodes: ExportedNode[] = [];

  /** 所有需要在 GetManagedObjects 中暴露的节点 */
  readonly managedEntries: ManagedEntry[] = [];

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  /**
   * 实时运行状态（供 ble_status 展示模拟控制状态）
   * 默认无额外状态；各设备类覆盖以暴露引擎/心率等实时值。
   */
  getLiveState(): Record<string, unknown> {
    return {};
  }

  /**
   * 原地热更新参数（不重建 GATT，保持中心设备连接，下一条 notify 即生效）。
   * 默认无操作；各设备类覆盖。注意：设备类型变更、服务结构变更仍需完整重启。
   */
  applyConfig(_config: SimulationConfig): void {
    /* 默认无热更新能力 */
  }

  /** 注册写入回调（用于将外部写入事件传递给 BleController） */
  setWriteHandler(handler: WriteHandler): void {
    this.writeHandler = handler;
  }

  /** 注册连接事件回调（StartNotify / StopNotify） */
  setConnectionEventHandler(handler: ConnectionEventHandler): void {
    this.connectionEventHandler = handler;
    // 将回调注册到所有已构建的 notify/writable characteristic
    for (const node of this.exportedNodes) {
      const iface = node.iface;
      if (
        iface instanceof NotifyCharacteristicInterface ||
        iface instanceof WritableCharacteristicInterface
      ) {
        const uuid = (iface as unknown as { UUID: string }).UUID ?? '';
        iface.setConnectionEventCallback((event) => handler(event, uuid));
      }
    }
  }

  /** 注册数据发送回调（有中心设备订阅时，每次 notify/indicate 推送触发） */
  setDataSentHandler(handler: DataSentHandler): void {
    this.dataSentHandler = handler;
    for (const node of this.exportedNodes) {
      const iface = node.iface;
      if (
        iface instanceof NotifyCharacteristicInterface ||
        iface instanceof WritableCharacteristicInterface
      ) {
        const uuid = (iface as unknown as { UUID: string }).UUID ?? '';
        iface.setDataSentCallback((value) => handler(uuid, value));
      }
    }
  }

  /** 停止所有定时器和通知 */
  abstract stop(): void;

  /** 获取此设备所有 D-Bus 对象的 ManagedObjects 字典 */
  getManagedObjects(): ManagedObjects {
    const objects: ManagedObjects = {};
    for (const entry of this.managedEntries) {
      if (!objects[entry.path]) objects[entry.path] = {};
      objects[entry.path][entry.interfaceName] = entry.properties();
    }
    return objects;
  }

  /**
   * 处理交互规则：当收到某个 characteristic 的写入时，
   * 根据 interactionRules 决定如何响应。
   * 返回 true 表示有规则匹配并已处理。
   */
  protected applyInteractionRules(
    charUuid: string,
    value: Buffer,
    charMap: Map<string, WritableCharacteristicInterface>,
  ): boolean {
    const rules = this.config.interactionRules ?? [];
    let matched = false;

    for (const rule of rules) {
      if (rule.trigger.characteristicUuid.toLowerCase() !== charUuid.toLowerCase()) continue;
      if (rule.trigger.opcodeHex !== null) {
        const opcode = value.length > 0 ? value[0]!.toString(16).padStart(2, '0') : '';
        if (opcode !== rule.trigger.opcodeHex.toLowerCase()) continue;
      }

      matched = true;
      const { action } = rule;

      if (action.type === 'indicate' || action.type === 'notify') {
        const targetUuid = (action.characteristicUuid ?? charUuid).toLowerCase();
        const targetChar = charMap.get(targetUuid);
        if (targetChar && action.responseHex) {
          const responseBytes = Buffer.from(action.responseHex.replace(/\s+/g, ''), 'hex');
          targetChar.emitResponse(responseBytes, action.type === 'indicate');
        }
      }
      // update_param is handled at the BleController level via writeHandler
    }

    return matched;
  }
}

// ─── GattServiceInterface ─────────────────────────────────────────────────────

export class GattServiceInterface extends Interface implements ManagedEntry {
  readonly path: string;
  readonly interfaceName = 'org.bluez.GattService1';
  private readonly uuid: string;
  private readonly primary: boolean;

  constructor(path: string, uuid: string, primary = true) {
    super('org.bluez.GattService1');
    this.path = path;
    this.uuid = uuid;
    this.primary = primary;
  }

  get UUID(): string { return this.uuid; }
  get Primary(): boolean { return this.primary; }
  get Includes(): string[] { return []; }

  properties(): Record<string, Variant> {
    return {
      UUID: new Variant('s', this.uuid),
      Primary: new Variant('b', this.primary),
      Includes: new Variant('ao', []),
    };
  }
}

GattServiceInterface.configureMembers({
  properties: {
    UUID: { signature: 's', access: ACCESS_READ },
    Primary: { signature: 'b', access: ACCESS_READ },
    Includes: { signature: 'ao', access: ACCESS_READ },
  },
});

// ─── ReadOnlyCharacteristicInterface ─────────────────────────────────────────

export class ReadOnlyCharacteristicInterface extends Interface implements ManagedEntry {
  readonly path: string;
  readonly interfaceName = 'org.bluez.GattCharacteristic1';
  private readonly uuid: string;
  private readonly servicePath: string;
  private valueFactory: () => Buffer;
  private currentValue: Buffer;

  constructor(opts: {
    path: string;
    uuid: string;
    servicePath: string;
    valueFactory: () => Buffer;
  }) {
    super('org.bluez.GattCharacteristic1');
    this.path = opts.path;
    this.uuid = opts.uuid;
    this.servicePath = opts.servicePath;
    this.valueFactory = opts.valueFactory;
    this.currentValue = this.valueFactory();
  }

  get UUID(): string { return this.uuid; }
  get Service(): string { return this.servicePath; }
  get Flags(): string[] { return ['read']; }
  get Notifying(): boolean { return false; }
  get Value(): Buffer { return this.currentValue; }

  ReadValue(_opts: Record<string, Variant>): Buffer {
    this.currentValue = this.valueFactory();
    return this.currentValue;
  }

  WriteValue(_val: Buffer, _opts: Record<string, Variant>): void {
    throw new (require('dbus-next').DBusError)('org.bluez.Error.NotPermitted', 'Read-only characteristic');
  }

  StartNotify(): void {
    throw new (require('dbus-next').DBusError)('org.bluez.Error.NotSupported', 'Not supported');
  }

  StopNotify(): void { /* noop */ }

  properties(): Record<string, Variant> {
    return {
      UUID: new Variant('s', this.uuid),
      Service: new Variant('o', this.servicePath),
      Flags: new Variant('as', ['read']),
      Value: new Variant('ay', this.currentValue),
      Notifying: new Variant('b', false),
    };
  }
}

ReadOnlyCharacteristicInterface.configureMembers({
  properties: {
    UUID: { signature: 's', access: ACCESS_READ },
    Service: { signature: 'o', access: ACCESS_READ },
    Flags: { signature: 'as', access: ACCESS_READ },
    Value: { signature: 'ay', access: ACCESS_READ },
    Notifying: { signature: 'b', access: ACCESS_READ },
  },
  methods: {
    ReadValue: { inSignature: 'a{sv}', outSignature: 'ay' },
    WriteValue: { inSignature: 'aya{sv}', outSignature: '' },
    StartNotify: { inSignature: '', outSignature: '' },
    StopNotify: { inSignature: '', outSignature: '' },
  },
});

// ─── NotifyCharacteristicInterface ───────────────────────────────────────────

export class NotifyCharacteristicInterface extends Interface implements ManagedEntry {
  readonly path: string;
  readonly interfaceName = 'org.bluez.GattCharacteristic1';
  private readonly uuid: string;
  private readonly servicePath: string;
  private valueFactory: () => Buffer;
  private readonly notifyIntervalMs: number;
  private currentValue: Buffer;
  private notifying = false;
  private notifyTimer: NodeJS.Timeout | null = null;
  private onConnectionEvent: ((event: 'central_connected' | 'central_disconnected') => void) | null = null;
  private onDataSent: ((value: Buffer) => void) | null = null;

  constructor(opts: {
    path: string;
    uuid: string;
    servicePath: string;
    valueFactory: () => Buffer;
    notifyIntervalMs: number;
  }) {
    super('org.bluez.GattCharacteristic1');
    this.path = opts.path;
    this.uuid = opts.uuid;
    this.servicePath = opts.servicePath;
    this.valueFactory = opts.valueFactory;
    this.notifyIntervalMs = opts.notifyIntervalMs;
    this.currentValue = this.valueFactory();
  }

  updateValueFactory(f: () => Buffer): void { this.valueFactory = f; }

  setConnectionEventCallback(cb: (event: 'central_connected' | 'central_disconnected') => void): void {
    this.onConnectionEvent = cb;
  }

  setDataSentCallback(cb: (value: Buffer) => void): void {
    this.onDataSent = cb;
  }

  get UUID(): string { return this.uuid; }
  get Service(): string { return this.servicePath; }
  get Flags(): string[] { return ['notify']; }
  get Notifying(): boolean { return this.notifying; }
  get Value(): Buffer { return this.currentValue; }

  ReadValue(_opts: Record<string, Variant>): Buffer {
    this.currentValue = this.valueFactory();
    return this.currentValue;
  }

  WriteValue(_val: Buffer, _opts: Record<string, Variant>): void {
    throw new (require('dbus-next').DBusError)('org.bluez.Error.NotPermitted', 'Not writable');
  }

  StartNotify(): void {
    if (this.notifying) return;
    this.notifying = true;
    Interface.emitPropertiesChanged(this, { Notifying: true }, []);
    this.onConnectionEvent?.('central_connected');
    this.emitValueUpdate();
    this.notifyTimer = setInterval(() => this.emitValueUpdate(), this.notifyIntervalMs);
  }

  StopNotify(): void {
    if (!this.notifying) return;
    this.notifying = false;
    if (this.notifyTimer) { clearInterval(this.notifyTimer); this.notifyTimer = null; }
    Interface.emitPropertiesChanged(this, { Notifying: false }, []);
    this.onConnectionEvent?.('central_disconnected');
  }

  stop(): void { this.StopNotify(); }

  emitValueUpdate(): void {
    this.currentValue = this.valueFactory();
    Interface.emitPropertiesChanged(this, { Value: this.currentValue }, []);
    if (this.notifying) this.onDataSent?.(this.currentValue);
  }

  properties(): Record<string, Variant> {
    return {
      UUID: new Variant('s', this.uuid),
      Service: new Variant('o', this.servicePath),
      Flags: new Variant('as', ['notify']),
      Value: new Variant('ay', this.currentValue),
      Notifying: new Variant('b', this.notifying),
    };
  }
}

NotifyCharacteristicInterface.configureMembers({
  properties: {
    UUID: { signature: 's', access: ACCESS_READ },
    Service: { signature: 'o', access: ACCESS_READ },
    Flags: { signature: 'as', access: ACCESS_READ },
    Value: { signature: 'ay', access: ACCESS_READ },
    Notifying: { signature: 'b', access: ACCESS_READ },
  },
  methods: {
    ReadValue: { inSignature: 'a{sv}', outSignature: 'ay' },
    WriteValue: { inSignature: 'aya{sv}', outSignature: '' },
    StartNotify: { inSignature: '', outSignature: '' },
    StopNotify: { inSignature: '', outSignature: '' },
  },
});

// ─── WritableCharacteristicInterface (write + indicate) ──────────────────────

export class WritableCharacteristicInterface extends Interface implements ManagedEntry {
  readonly path: string;
  readonly interfaceName = 'org.bluez.GattCharacteristic1';
  private readonly uuid: string;
  private readonly servicePath: string;
  private currentValue: Buffer;
  private readonly flags: string[];
  private onWrite: ((value: Buffer) => void) | null = null;
  private onConnectionEvent: ((event: 'central_connected' | 'central_disconnected') => void) | null = null;
  private onDataSent: ((value: Buffer) => void) | null = null;
  private notifying = false;
  private notifyTimer: NodeJS.Timeout | null = null;
  private notifyFactory: (() => Buffer) | null = null;
  private notifyIntervalMs = 0;

  constructor(opts: {
    path: string;
    uuid: string;
    servicePath: string;
    /** 'write' | 'write-without-response' | plus 'indicate' or 'notify' */
    flags: string[];
    initialValue?: Buffer;
    /** Optional notify/indicate factory for autonomous push */
    notifyFactory?: () => Buffer;
    notifyIntervalMs?: number;
  }) {
    super('org.bluez.GattCharacteristic1');
    this.path = opts.path;
    this.uuid = opts.uuid;
    this.servicePath = opts.servicePath;
    this.flags = opts.flags;
    this.currentValue = opts.initialValue ?? Buffer.alloc(0);
    if (opts.notifyFactory) {
      this.notifyFactory = opts.notifyFactory;
      this.notifyIntervalMs = opts.notifyIntervalMs ?? 1000;
    }
  }

  setWriteCallback(fn: (value: Buffer) => void): void { this.onWrite = fn; }

  setConnectionEventCallback(cb: (event: 'central_connected' | 'central_disconnected') => void): void {
    this.onConnectionEvent = cb;
  }

  setDataSentCallback(cb: (value: Buffer) => void): void {
    this.onDataSent = cb;
  }

  get UUID(): string { return this.uuid; }
  get Service(): string { return this.servicePath; }
  get Flags(): string[] { return this.flags; }
  get Notifying(): boolean { return this.notifying; }
  get Value(): Buffer { return this.currentValue; }

  ReadValue(_opts: Record<string, Variant>): Buffer { return this.currentValue; }

  WriteValue(value: Buffer, _opts: Record<string, Variant>): void {
    this.currentValue = value;
    this.onWrite?.(value);
  }

  StartNotify(): void {
    if (this.notifying || !this.notifyFactory) return;
    this.notifying = true;
    Interface.emitPropertiesChanged(this, { Notifying: true }, []);
    this.onConnectionEvent?.('central_connected');
    if (this.notifyIntervalMs > 0) {
      this.notifyTimer = setInterval(() => this.emitResponse(this.notifyFactory!()), this.notifyIntervalMs);
    }
  }

  StopNotify(): void {
    if (!this.notifying) return;
    this.notifying = false;
    if (this.notifyTimer) { clearInterval(this.notifyTimer); this.notifyTimer = null; }
    Interface.emitPropertiesChanged(this, { Notifying: false }, []);
    this.onConnectionEvent?.('central_disconnected');
  }

  stop(): void { this.StopNotify(); }

  /** Emit an indication or notification response */
  emitResponse(value: Buffer, _indicate = false): void {
    this.currentValue = value;
    Interface.emitPropertiesChanged(this, { Value: this.currentValue }, []);
    if (this.notifying) this.onDataSent?.(value);
  }

  properties(): Record<string, Variant> {
    return {
      UUID: new Variant('s', this.uuid),
      Service: new Variant('o', this.servicePath),
      Flags: new Variant('as', this.flags),
      Value: new Variant('ay', this.currentValue),
      Notifying: new Variant('b', this.notifying),
    };
  }
}

WritableCharacteristicInterface.configureMembers({
  properties: {
    UUID: { signature: 's', access: ACCESS_READ },
    Service: { signature: 'o', access: ACCESS_READ },
    Flags: { signature: 'as', access: ACCESS_READ },
    Value: { signature: 'ay', access: ACCESS_READ },
    Notifying: { signature: 'b', access: ACCESS_READ },
  },
  methods: {
    ReadValue: { inSignature: 'a{sv}', outSignature: 'ay' },
    WriteValue: { inSignature: 'aya{sv}', outSignature: '' },
    StartNotify: { inSignature: '', outSignature: '' },
    StopNotify: { inSignature: '', outSignature: '' },
  },
});

// ─── Device Info Service helper ───────────────────────────────────────────────

const DEVICE_INFO_UUID = '180a';

export function buildDeviceInfoService(
  appPath: string,
  serviceIndex: number,
  info: { deviceName: string; serialNumber: string; modelNumber: string; firmwareRevision: string; hardwareRevision: string; softwareRevision: string; manufacturer: string },
): { service: GattServiceInterface; characteristics: ReadOnlyCharacteristicInterface[]; nodes: ExportedNode[]; entries: ManagedEntry[] } {
  const svcPath = `${appPath}/service${serviceIndex}`;

  const service = new GattServiceInterface(svcPath, DEVICE_INFO_UUID);

  const chars: ReadOnlyCharacteristicInterface[] = [
    new ReadOnlyCharacteristicInterface({ path: `${svcPath}/char0`, uuid: '2a24', servicePath: svcPath, valueFactory: () => Buffer.from(info.modelNumber, 'utf8') }),
    new ReadOnlyCharacteristicInterface({ path: `${svcPath}/char1`, uuid: '2a25', servicePath: svcPath, valueFactory: () => Buffer.from(info.serialNumber, 'utf8') }),
    new ReadOnlyCharacteristicInterface({ path: `${svcPath}/char2`, uuid: '2a26', servicePath: svcPath, valueFactory: () => Buffer.from(info.firmwareRevision, 'utf8') }),
    new ReadOnlyCharacteristicInterface({ path: `${svcPath}/char3`, uuid: '2a27', servicePath: svcPath, valueFactory: () => Buffer.from(info.hardwareRevision, 'utf8') }),
    new ReadOnlyCharacteristicInterface({ path: `${svcPath}/char4`, uuid: '2a28', servicePath: svcPath, valueFactory: () => Buffer.from(info.softwareRevision, 'utf8') }),
    new ReadOnlyCharacteristicInterface({ path: `${svcPath}/char5`, uuid: '2a29', servicePath: svcPath, valueFactory: () => Buffer.from(info.manufacturer, 'utf8') }),
  ];

  const nodes: ExportedNode[] = [{ path: svcPath, iface: service }, ...chars.map((c) => ({ path: c.path, iface: c }))];
  const entries: ManagedEntry[] = [service, ...chars];

  return { service, characteristics: chars, nodes, entries };
}
