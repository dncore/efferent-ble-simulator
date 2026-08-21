/**
 * BleController — BLE 生命周期管理器
 *
 * 支持四种设备类型：heart_rate / cycling_power / csc / ftms
 * 每种设备由对应的 Device 类封装，Controller 负责 BlueZ D-Bus 连接管理。
 */

import dbus, { MessageBus, Variant, interface as dbusInterface } from 'dbus-next';
import { SimulationConfig, SimulatorDatabase } from './database';
import { BaseDevice, ManagedObjects } from './devices/base';
import { HeartRateDevice } from './devices/heart-rate';
import { CyclingPowerDevice } from './devices/cycling-power';
import { CSCDevice } from './devices/csc';
import { FTMSDevice } from './devices/ftms';

const { Interface } = dbusInterface;

const BLUEZ_SERVICE_NAME = 'org.bluez';
const APP_PATH = '/org/openride';
const AD_PATH = `${APP_PATH}/advertisement0`;

// ─── Advertisement D-Bus interface ───────────────────────────────────────────

const ACCESS_READ = dbusInterface.ACCESS_READ;

class AdvertisementInterface extends Interface {
  readonly path = AD_PATH;
  readonly interfaceName = 'org.bluez.LEAdvertisement1';

  private readonly _localName: string;
  private readonly _serviceUuids: string[];
  private readonly _appearance: number;

  constructor(localName: string, serviceUuids: string[], appearance: number) {
    super('org.bluez.LEAdvertisement1');
    this._localName = localName;
    this._serviceUuids = serviceUuids;
    this._appearance = appearance;
  }

  get Type(): string { return 'peripheral'; }
  get ServiceUUIDs(): string[] { return this._serviceUuids; }
  get LocalName(): string { return this._localName; }
  get Includes(): string[] { return []; }
  get Appearance(): number { return this._appearance; }

  Release(): void { console.log('[BLE] Advertisement released by BlueZ'); }

  properties(): Record<string, Variant> {
    return {
      Type: new Variant('s', 'peripheral'),
      ServiceUUIDs: new Variant('as', this._serviceUuids),
      LocalName: new Variant('s', this._localName),
      Includes: new Variant('as', []),
      Appearance: new Variant('q', this._appearance),
    };
  }
}

AdvertisementInterface.configureMembers({
  properties: {
    Type: { signature: 's', access: ACCESS_READ },
    ServiceUUIDs: { signature: 'as', access: ACCESS_READ },
    LocalName: { signature: 's', access: ACCESS_READ },
    Includes: { signature: 'as', access: ACCESS_READ },
    Appearance: { signature: 'q', access: ACCESS_READ },
  },
  methods: { Release: { inSignature: '', outSignature: '' } },
});

// ─── ObjectManager D-Bus interface ───────────────────────────────────────────

class ObjectManagerInterface extends Interface {
  private readonly getObjects: () => ManagedObjects;

  constructor(getObjects: () => ManagedObjects) {
    super('org.freedesktop.DBus.ObjectManager');
    this.getObjects = getObjects;
  }

  GetManagedObjects(): ManagedObjects { return this.getObjects(); }
}

ObjectManagerInterface.configureMembers({
  methods: { GetManagedObjects: { outSignature: 'a{oa{sa{sv}}}' } },
});

// ─── BlueZ helpers ────────────────────────────────────────────────────────────

async function findAdapterPath(bus: MessageBus): Promise<string> {
  const rootObj = await bus.getProxyObject(BLUEZ_SERVICE_NAME, '/');
  const om = rootObj.getInterface('org.freedesktop.DBus.ObjectManager') as unknown as {
    GetManagedObjects: () => Promise<Record<string, Record<string, unknown>>>;
  };
  const managed = await om.GetManagedObjects();
  for (const [path, ifaces] of Object.entries(managed)) {
    if (ifaces['org.bluez.GattManager1'] && ifaces['org.bluez.LEAdvertisingManager1']) return path;
  }
  throw new Error('No BLE adapter with GattManager1 and LEAdvertisingManager1 found');
}

async function ensureAdapterReady(bus: MessageBus, adapterPath: string): Promise<void> {
  const adapterObj = await bus.getProxyObject(BLUEZ_SERVICE_NAME, adapterPath);
  const props = adapterObj.getInterface('org.freedesktop.DBus.Properties') as unknown as {
    Set: (iface: string, prop: string, value: Variant) => Promise<void>;
  };
  await props.Set('org.bluez.Adapter1', 'Powered', new Variant('b', true));
  await props.Set('org.bluez.Adapter1', 'Pairable', new Variant('b', true));
}

// ─── BLE broadcast identity helpers ──────────────────────────────────────────

/**
 * Build the DeviceInfo that is actually exposed over the air.
 *
 * serialNumber 策略（可通过环境变量 SIM_SERIAL_STABLE=1 切换）：
 *   • 默认："<userSerial>-S<sessionId>"（如 "SIM001-S42"）——每次会话变化，
 *     强制中心设备重新发现，但严格校验序列号的 App 需要“忘记设备”才能重连。
 *   • 稳定模式："<userSerial>-<TYPE>"（如 "SIM001-FTMS"）——同设备类型会话
 *     序列号稳定，App 配对一次后 stop→start 可无缝重连（无需忘记设备）；
 *     设备类型切换仍会改变序列号，强制重新发现（GATT 结构不同）。
 */
function buildBroadcastDeviceInfo(
  cfg: SimulationConfig,
  sessionId: number,
): SimulationConfig['deviceInfo'] {
  const stable = process.env['SIM_SERIAL_STABLE'] === '1';
  if (stable) {
    const typeTag: Record<string, string> = {
      heart_rate: 'HR', cycling_power: 'CP', csc: 'CSC', ftms: 'FTMS',
    };
    return {
      ...cfg.deviceInfo,
      serialNumber: `${cfg.deviceInfo.serialNumber}-${typeTag[cfg.deviceType] ?? cfg.deviceType}`,
    };
  }
  return {
    ...cfg.deviceInfo,
    serialNumber: `${cfg.deviceInfo.serialNumber}-S${sessionId}`,
  };
}

// ─── Device factory ───────────────────────────────────────────────────────────

function createDevice(config: SimulationConfig): BaseDevice {
  switch (config.deviceType) {
    case 'heart_rate':    return new HeartRateDevice(config);
    case 'cycling_power': return new CyclingPowerDevice(config);
    case 'csc':           return new CSCDevice(config);
    case 'ftms':          return new FTMSDevice(config);
    default:
      throw new Error(`Unknown device type: ${String((config as SimulationConfig).deviceType)}`);
  }
}

function getAdvertisementMeta(config: SimulationConfig): { serviceUuids: string[]; appearance: number } {
  switch (config.deviceType) {
    case 'heart_rate':    return { serviceUuids: HeartRateDevice.advertisedServiceUuids, appearance: HeartRateDevice.appearance };
    case 'cycling_power': return { serviceUuids: CyclingPowerDevice.advertisedServiceUuids, appearance: CyclingPowerDevice.appearance };
    case 'csc':           return { serviceUuids: CSCDevice.advertisedServiceUuids, appearance: CSCDevice.appearance };
    case 'ftms':          return { serviceUuids: FTMSDevice.advertisedServiceUuids, appearance: FTMSDevice.appearance };
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type BleState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface BleStatus {
  state: BleState;
  config: SimulationConfig | null;
  sessionId: number | null;
  adapterPath: string | null;
  startedAt: Date | null;
  error: string | null;
}

/** Callback fired when a BLE central writes to a characteristic */
export type BleWriteCallback = (characteristicUuid: string, valueHex: string) => void;

// ─── BleController ────────────────────────────────────────────────────────────

export class BleController {
  private state: BleState = 'stopped';
  private currentConfig: SimulationConfig | null = null;
  private currentSessionId: number | null = null;
  private adapterPath: string | null = null;
  private startedAt: Date | null = null;
  private lastError: string | null = null;

  private bus: MessageBus | null = null;
  private device: BaseDevice | null = null;
  private advertisement: AdvertisementInterface | null = null;
  private objectManager: ObjectManagerInterface | null = null;
  private gattManager: { RegisterApplication: (p: string, o: Record<string, Variant>) => Promise<void>; UnregisterApplication?: (p: string) => Promise<void> } | null = null;
  private adManager: { RegisterAdvertisement: (p: string, o: Record<string, Variant>) => Promise<void>; UnregisterAdvertisement: (p: string) => Promise<void> } | null = null;

  /** External callback for write events from BLE centrals */
  private writeCallback: BleWriteCallback | null = null;

  /** Optional database reference for persistent logging */
  private db: SimulatorDatabase | null = null;

  setDatabase(db: SimulatorDatabase): void {
    this.db = db;
  }

  private log(
    eventType: Parameters<SimulatorDatabase['appendLog']>[0]['eventType'],
    message: string,
    opts: { characteristicUuid?: string; dataHex?: string } = {},
  ): void {
    if (!this.db) return;
    try {
      this.db.appendLog({
        sessionId: this.currentSessionId,
        eventType,
        message,
        characteristicUuid: opts.characteristicUuid ?? null,
        dataHex: opts.dataHex ?? null,
      });
    } catch { /* logging must never throw */ }
  }

  setWriteCallback(cb: BleWriteCallback | null): void {
    this.writeCallback = cb;
    if (this.device) {
      this.device.setWriteHandler(cb ? (uuid, buf) => cb(uuid, buf.toString('hex')) : () => {});
    }
  }

  async start(cfg: SimulationConfig, sessionId: number): Promise<void> {
    if (this.state !== 'stopped') throw new Error(`Cannot start: state is "${this.state}"`);
    if (process.platform !== 'linux') throw new Error('BlueZ D-Bus peripheral mode is Linux-only');

    this.state = 'starting';
    this.lastError = null;
    this.currentSessionId = sessionId;

    try {
      const bus = dbus.systemBus();
      bus.on('error', (err: unknown) => console.error('[BLE] D-Bus error:', err));

      const adapterPath = await findAdapterPath(bus);
      await ensureAdapterReady(bus, adapterPath);

      const adapterObj = await bus.getProxyObject(BLUEZ_SERVICE_NAME, adapterPath);
      const gattManager = adapterObj.getInterface('org.bluez.GattManager1') as unknown as typeof this.gattManager;
      const adManager = adapterObj.getInterface('org.bluez.LEAdvertisingManager1') as unknown as typeof this.adManager;

      // Build broadcast-specific DeviceInfo (scheme B + D):
      //   - deviceName prefixed with device type  → forces re-discovery on type change
      //   - serialNumber suffixed with session ID  → forces re-discovery on every restart
      const broadcastInfo = buildBroadcastDeviceInfo(cfg, sessionId);
      const broadcastCfg: SimulationConfig = { ...cfg, deviceInfo: broadcastInfo };

      // Build device using broadcast config so GATT Device Info characteristics
      // expose the transformed name/serial over the air
      const device = createDevice(broadcastCfg);

      // Write handler: log every write from a central, then forward to external callback
      device.setWriteHandler((uuid, buf) => {
        this.log('write_received', `Write on char ${uuid}: ${buf.toString('hex')}`, {
          characteristicUuid: uuid,
          dataHex: buf.toString('hex'),
        });
        this.writeCallback?.(uuid, buf.toString('hex'));
      });

      // Connection event handler: log central connect/disconnect
      device.setConnectionEventHandler((event, uuid) => {
        if (event === 'central_connected') {
          this.log('central_connected', `Central subscribed to char ${uuid}`, { characteristicUuid: uuid });
          console.log(`[BLE] Central connected (subscribed) — char: ${uuid}`);
        } else {
          this.log('central_disconnected', `Central unsubscribed from char ${uuid}`, { characteristicUuid: uuid });
          console.log(`[BLE] Central disconnected (unsubscribed) — char: ${uuid}`);
        }
      });

      // Data sent handler: log every notify/indicate pushed to central (only when subscribed)
      device.setDataSentHandler((uuid, buf) => {
        this.log('notify_sent', `Notify on char ${uuid}: ${buf.toString('hex')}`, {
          characteristicUuid: uuid,
          dataHex: buf.toString('hex'),
        });
      });

      // Build ObjectManager
      const adMeta = getAdvertisementMeta(cfg);
      const advertisement = new AdvertisementInterface(broadcastInfo.deviceName, adMeta.serviceUuids, adMeta.appearance);

      const objectManager = new ObjectManagerInterface(() => {
        const deviceObjs = device.getManagedObjects();
        deviceObjs[AD_PATH] = { [advertisement.interfaceName]: advertisement.properties() };
        return deviceObjs;
      });

      // Export all D-Bus objects
      bus.export(APP_PATH, objectManager);
      bus.export(AD_PATH, advertisement);
      for (const node of device.exportedNodes) {
        bus.export(node.path, node.iface);
      }

      await gattManager!.RegisterApplication(APP_PATH, {});
      console.log('[BLE] GATT application registered successfully');
      try {
        await adManager!.RegisterAdvertisement(AD_PATH, {});
        console.log('[BLE] Advertisement registered successfully');
      } catch (adErr: unknown) {
        const e = adErr as { message?: string; text?: string; name?: string; stack?: string };
        console.error('[BLE] RegisterAdvertisement failed:', e.message ?? String(adErr));
        console.error('[BLE] Full error:', JSON.stringify(adErr, Object.getOwnPropertyNames(adErr)));
        throw adErr;
      }

      this.bus = bus;
      this.device = device;
      this.advertisement = advertisement;
      this.objectManager = objectManager;
      this.gattManager = gattManager;
      this.adManager = adManager;
      this.adapterPath = adapterPath;
      this.currentConfig = cfg;       // store original config (without broadcast transforms)
      this.currentSessionId = sessionId;
      this.startedAt = new Date();
      this.state = 'running';

      this.log('simulator_start', `模拟器已启动 — 类型: ${cfg.deviceType}, 广播名: "${broadcastInfo.deviceName}", 序列号: "${broadcastInfo.serialNumber}", 适配器: ${adapterPath}`);
      console.log(`[BLE] Started — type: ${cfg.deviceType}, broadcast: "${broadcastInfo.deviceName}" (serial: ${broadcastInfo.serialNumber}), adapter: ${adapterPath}`);
    } catch (err) {
      this.state = 'stopped';
      this.currentSessionId = null;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log('error', `启动失败: ${this.lastError}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.state !== 'running') throw new Error(`Cannot stop: state is "${this.state}"`);
    this.state = 'stopping';

    try {
      this.device?.stop();

      try { await this.adManager?.UnregisterAdvertisement(AD_PATH); }
      catch (e) { console.warn('[BLE] UnregisterAdvertisement warning:', e); }

      try {
        if (this.gattManager?.UnregisterApplication) await this.gattManager.UnregisterApplication(APP_PATH);
      } catch (e) { console.warn('[BLE] UnregisterApplication warning:', e); }

      if (this.bus) {
        if (this.objectManager) this.bus.unexport(APP_PATH, this.objectManager);
        if (this.advertisement) this.bus.unexport(AD_PATH, this.advertisement);
        if (this.device) {
          for (const node of this.device.exportedNodes) this.bus.unexport(node.path, node.iface);
        }
        this.bus.disconnect();
      }
    } finally {
      this.log('simulator_stop', `模拟器已停止 — 设备: "${this.currentConfig?.deviceInfo.deviceName ?? '—'}"`);
      this.bus = null; this.device = null; this.advertisement = null;
      this.objectManager = null; this.gattManager = null; this.adManager = null;
      this.adapterPath = null; this.startedAt = null;
      this.currentSessionId = null;
      this.state = 'stopped';
      console.log('[BLE] Stopped');
    }
  }

  async restart(cfg?: SimulationConfig, sessionId?: number): Promise<void> {
    const newCfg = cfg ?? this.currentConfig;
    const newId = sessionId ?? this.currentSessionId;
    if (!newCfg || newId === null || newId === undefined) throw new Error('No configuration available for restart');
    if (this.state === 'running') await this.stop();
    await this.start(newCfg, newId);
  }

  /**
   * 原地热更新参数（不重启、不重建 GATT、不断开中心设备连接）。
   * 仅限同设备类型的参数级变更；设备类型变化需走 restart。
   */
  async updateParams(cfg: SimulationConfig): Promise<void> {
    if (this.state !== 'running') throw new Error(`Cannot update: state is "${this.state}"`);
    if (!this.device || !this.currentConfig) throw new Error('No device running');
    if (this.currentConfig.deviceType !== cfg.deviceType) {
      throw new Error('设备类型变更需要完整重启');
    }
    this.device.applyConfig(cfg);
    this.currentConfig = cfg;
    this.log('param_updated', `模拟参数已热更新 — 类型: ${cfg.deviceType}, 名称: ${cfg.deviceInfo.deviceName}`);
  }

  getStatus(): BleStatus {
    return {
      state: this.state,
      config: this.currentConfig,
      sessionId: this.currentSessionId,
      adapterPath: this.adapterPath,
      startedAt: this.startedAt,
      error: this.lastError,
    };
  }

  /** 设备实时运行状态（骑行中/阶段/功率等），用于 ble_status 展示 */
  getLiveState(): Record<string, unknown> {
    return this.device?.getLiveState() ?? {};
  }

  get isRunning(): boolean { return this.state === 'running'; }
}
