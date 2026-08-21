import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { doAction, mcpCall } from '@/lib/api';
import { DEVICE_SCHEMAS, SIM_SCHEMA, SCENARIO_TYPES, DEVICE_TYPE_LABELS, type DeviceType, type FieldDef } from '@/lib/schemas';
import { fmtTime } from '@/lib/time';
import { formBus } from '@/lib/formBus';

function FieldControl({
  field, value, onChange,
}: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const v = value ?? field.def;
  if (field.type === 'bool') {
    return (
      <div className="flex items-center gap-2">
        <Switch checked={!!v} onCheckedChange={(c) => onChange(c)} />
        <Label>{field.label}</Label>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{field.label}</Label>
        <Select value={String(v)} onValueChange={(s) => onChange(s)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{field.label}</Label>
      <Input
        type="number"
        value={String(v)}
        min={field.min} max={field.max} step={field.step}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </div>
  );
}

function FormFields({
  fields, values, onChange, cols = 4,
}: { fields: FieldDef[]; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void; cols?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {fields.map((f) => (
        <FieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
      ))}
    </div>
  );
}

const DEFAULT_INFO = { deviceName: 'OPEN_RIDE', manufacturer: 'Open Ride', modelNumber: 'OPEN_RIDE', firmwareRevision: '1.0.0', hardwareRevision: '1.0', softwareRevision: '1.0' };

export function ControlTab({ deviceState }: { deviceState: string }) {
  const [deviceType, setDeviceType] = useState<DeviceType>('ftms');
  const [deviceInfo, setDeviceInfo] = useState<Record<string, string>>({ ...DEFAULT_INFO });
  const [serial, setSerial] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [sim, setSim] = useState<Record<string, unknown>>({});
  const [scenario, setScenario] = useState<Record<string, unknown>>({ type: 'ride_script', repeat: true });
  const [busy, setBusy] = useState(false);
  // 弹窗状态
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showLoad, setShowLoad] = useState(false);
  const [cfgRows, setCfgRows] = useState<{ id: number; name: string; deviceType: string; deviceName: string; updatedAt: string }[]>([]);
  const [confirmAction, setConfirmAction] = useState<'stop' | 'restart' | null>(null);

  // 初始化表单为 schema 默认值
  const initDefaults = (dt: DeviceType) => {
    const p: Record<string, unknown> = {};
    for (const f of DEVICE_SCHEMAS[dt]) p[f.key] = f.def;
    setParams(p);
    const s: Record<string, unknown> = {};
    for (const f of SIM_SCHEMA) s[f.key] = f.def;
    setSim(s);
  };
  useEffect(() => { initDefaults(deviceType); }, [deviceType]);

  // 订阅模板/配置载入
  useEffect(() => {
    return formBus.subscribe((args) => {
      const dt = args.deviceType as DeviceType;
      if (dt) {
        setDeviceType(dt);
        // deviceType 变化触发 initDefaults（异步），先手动设置默认再覆盖
        const p: Record<string, unknown> = {};
        for (const f of DEVICE_SCHEMAS[dt]) p[f.key] = f.def;
        setParams(p);
      }
      const info = args.deviceInfo as Record<string, string> | undefined;
      if (info) {
        setDeviceInfo({
          deviceName: info.deviceName ?? '', manufacturer: info.manufacturer ?? '',
          modelNumber: info.modelNumber ?? '', firmwareRevision: info.firmwareRevision ?? '',
          hardwareRevision: info.hardwareRevision ?? '', softwareRevision: info.softwareRevision ?? '',
        });
        setSerial(info.serialNumber ?? '');
      }
      const deviceParams = args[dt ?? 'ftms'] as Record<string, unknown> | undefined;
      if (deviceParams) {
        const p: Record<string, unknown> = {};
        for (const f of DEVICE_SCHEMAS[dt ?? 'ftms']) p[f.key] = f.def;
        for (const [k, v] of Object.entries(deviceParams)) if (v !== undefined) p[k] = v;
        setParams(p);
        const s: Record<string, unknown> = {};
        for (const f of SIM_SCHEMA) s[f.key] = f.def;
        const deviceSim = deviceParams.simulation as Record<string, unknown> | undefined;
        if (deviceSim) {
          for (const [k, v] of Object.entries(deviceSim)) if (v !== undefined && k !== 'scenario') s[k] = v;
          setSim(s);
          setScenario((deviceSim.scenario as Record<string, unknown>) ?? { type: 'ride_script', repeat: true });
        } else {
          setSim(s);
          setScenario({ type: 'ride_script', repeat: true });
        }
      }
    });
  }, []);

  const buildArgs = (): Record<string, unknown> => {
    const dt = deviceType;
    const info: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(deviceInfo)) if (v) info[k] = v;
    if (serial) info.serialNumber = serial;
    const deviceParams: Record<string, unknown> = { ...params };
    if (dt !== 'heart_rate') {
      deviceParams.simulation = { ...sim, scenario };
    }
    return { deviceType: dt, deviceInfo: info, [dt]: deviceParams };
  };

  const run = (name: string, label: string) => {
    setBusy(true);
    let args: Record<string, unknown>;
    try { args = buildArgs(); } catch (e) { toast.error('参数错误', { description: e instanceof Error ? e.message : String(e) }); setBusy(false); return; }
    doAction(() => mcpCall(name, args), { loading: label, success: label }).finally(() => setBusy(false));
  };

  // ── 保存/载入命名配置（Dialog）───────────────────────────────
  const openSaveDialog = () => { setSaveName(''); setShowSave(true); };
  const doSave = async () => {
    if (!saveName.trim()) { toast.error('请输入配置名称'); return; }
    let args: Record<string, unknown>;
    try { args = buildArgs(); } catch (e) { toast.error('参数错误', { description: e instanceof Error ? e.message : String(e) }); return; }
    setBusy(true);
    try {
      const text = await mcpCall('ble_save_config', { name: saveName.trim(), config: args });
      setShowSave(false);
      toast.success('配置已保存', { description: text });
    } catch (e) { toast.error('保存失败', { description: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
  };

  const openLoadDialog = async () => {
    setShowLoad(true);
    try {
      const text = await mcpCall('ble_list_configs');
      setCfgRows(text.split('\n').filter((l) => l.trim().startsWith('#')).map((l) => ({
        id: Number((l.match(/#(\d+)/) ?? [])[1] ?? 0),
        name: (l.match(/\[([^\]]+)\]/) ?? [])[1] ?? '',
        deviceType: (l.match(/\]\s+([a-z_]+)/) ?? [])[1] ?? '',
        deviceName: (l.match(/\/([^|]+?)\s*\|/) ?? [])[1]?.trim() ?? '',
        updatedAt: (l.match(/\|\s*更新:\s*(.+)$/) ?? [])[1]?.trim() ?? '',
      })));
    } catch { setCfgRows([]); }
  };

  const doLoadFromList = async (id: number, name: string) => {
    setBusy(true);
    try {
      const json = await mcpCall('ble_get_config_detail', { id });
      const parsed = JSON.parse(json);
      if (parsed.config) formBus.set(parsed.config);
      setShowLoad(false);
      toast.success(`已载入「${name}」到表单`, { description: deviceState === 'running' ? '点击「保存配置」热更新生效，或「重启」应用' : '点击「启动」开始模拟' });
    } catch (e) { toast.error('载入失败', { description: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
  };

  const running = deviceState === 'running';

  const scenarioType = (scenario.type as string) ?? 'ride_script';
  const setSc = (k: string, v: unknown) => setScenario((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>启动 / 重启模拟</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">设备类型</Label>
              <Select value={deviceType} onValueChange={(v) => setDeviceType(v as DeviceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEVICE_TYPE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">设备名（广播名）</Label>
              <Input value={deviceInfo.deviceName} onChange={(e) => setDeviceInfo((d) => ({ ...d, deviceName: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">序列号</Label>
              <Input value={serial} placeholder="留空自动生成" onChange={(e) => setSerial(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">制造商</Label>
              <Input value={deviceInfo.manufacturer} onChange={(e) => setDeviceInfo((d) => ({ ...d, manufacturer: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">型号</Label>
              <Input value={deviceInfo.modelNumber} onChange={(e) => setDeviceInfo((d) => ({ ...d, modelNumber: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">固件版本</Label>
              <Input value={deviceInfo.firmwareRevision} onChange={(e) => setDeviceInfo((d) => ({ ...d, firmwareRevision: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">硬件版本</Label>
              <Input value={deviceInfo.hardwareRevision} onChange={(e) => setDeviceInfo((d) => ({ ...d, hardwareRevision: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">软件版本</Label>
              <Input value={deviceInfo.softwareRevision} onChange={(e) => setDeviceInfo((d) => ({ ...d, softwareRevision: e.target.value }))} /></div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">设备参数</h3>
            <FormFields fields={DEVICE_SCHEMAS[deviceType]} values={params} onChange={(k, v) => setParams((p) => ({ ...p, [k]: v }))} />
          </div>

          {deviceType !== 'heart_rate' && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">动态模拟</h3>
                <FormFields fields={SIM_SCHEMA} values={sim} onChange={(k, v) => setSim((s) => ({ ...s, [k]: v }))} />
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">骑行场景</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">场景类型</Label>
                    <Select value={scenarioType} onValueChange={(v) => setScenario({ type: v, ...(v === 'ride_script' ? { repeat: true } : {}) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SCENARIO_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {scenarioType === 'ride_script' && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">循环播放</Label>
                        <Select value={String(!!scenario.repeat)} onValueChange={(v) => setSc('repeat', v === 'true')}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="true">是</SelectItem><SelectItem value="false">否</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-2 space-y-1">
                        <Label className="text-xs text-muted-foreground">剧本阶段 JSON（留空用默认剧本）</Label>
                        <Textarea rows={4} className="font-mono text-xs" value={scenario.phases ? JSON.stringify(scenario.phases, null, 1) : ''}
                          placeholder='[{"type":"climb","durationSeconds":60,"targetPower":260,"grade":5}]'
                          onChange={(e) => { const t = e.target.value.trim(); try { setSc('phases', t ? JSON.parse(t) : undefined); } catch { /* 未完成输入 */ } }} />
                      </div>
                    </>
                  )}
                  {scenarioType === 'intervals' && (['highPowerFactor', 'lowPowerFactor', 'intervalSeconds', 'restSeconds', 'sets'] as const).map((k, i) => (
                    <div key={k} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{{ highPowerFactor: '高功率倍率', lowPowerFactor: '低功率倍率', intervalSeconds: '高强度秒数', restSeconds: '休息秒数', sets: '组数' }[k]}</Label>
                      <Input type="number" step={k.includes('Factor') ? 0.1 : 1} value={String(scenario[k] ?? (i < 2 ? 1 : 1))}
                        onChange={(e) => setSc(k, Number(e.target.value))} />
                    </div>
                  ))}
                  {scenarioType === 'warmup_main_cooldown' && (['warmupMinutes', 'mainMinutes', 'cooldownMinutes', 'mainPowerFactor'] as const).map((k) => (
                    <div key={k} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{{ warmupMinutes: '热身分钟', mainMinutes: '主课分钟', cooldownMinutes: '冷却分钟', mainPowerFactor: '主课功率倍率' }[k]}</Label>
                      <Input type="number" step={k === 'mainPowerFactor' ? 0.1 : 1} value={String(scenario[k] ?? 1)} onChange={(e) => setSc(k, Number(e.target.value))} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {running ? (
              <AlertDialog open={confirmAction === 'stop'} onOpenChange={(o) => !o && setConfirmAction(null)}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={busy}>停止</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认停止模拟？</AlertDialogTitle>
                    <AlertDialogDescription>停止后将断开已连接设备的 BLE 连接，再次启动需重新连接。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { setConfirmAction(null); run('ble_stop', '正在停止模拟'); }}>确认停止</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button disabled={busy} onClick={() => run('ble_start', '正在启动模拟')}>启动</Button>
            )}
            <AlertDialog open={confirmAction === 'restart'} onOpenChange={(o) => !o && setConfirmAction(null)}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy}>重启</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认重启模拟？</AlertDialogTitle>
                  <AlertDialogDescription>将按当前表单参数重新启动模拟（已连接设备需重新连接）。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setConfirmAction(null); run('ble_restart', '正在重启模拟'); }}>确认重启</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" disabled={busy} onClick={openSaveDialog}>保存配置</Button>
            <Button variant="outline" disabled={busy} onClick={openLoadDialog}>载入已保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {running
              ? '运行中：修改参数后点「保存配置」即热更新生效（连接保持）；「重启」用新参数重建。'
              : '未运行：点「启动」开始模拟；「保存配置」将当前参数存为命名配置（上限 20 条）。'}
          </p>

          {/* 保存配置 Dialog */}
          <Dialog open={showSave} onOpenChange={setShowSave}>
            <DialogContent>
              <DialogHeader><DialogTitle>保存配置</DialogTitle><DialogDescription>为当前参数命名保存，可在「载入已保存」/「配置列表」中调用</DialogDescription></DialogHeader>
              <div className="space-y-2">
                <Label>配置名称</Label>
                <Input value={saveName} placeholder="如：FTP 测试 280W" onChange={(e) => setSaveName(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSave(false)}>取消</Button>
                <Button disabled={busy} onClick={doSave}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 载入已保存 Dialog */}
          <Dialog open={showLoad} onOpenChange={setShowLoad}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>载入已保存配置</DialogTitle><DialogDescription>选择要载入到表单的配置</DialogDescription></DialogHeader>
              <div className="max-h-[360px] space-y-1 overflow-y-auto">
                {cfgRows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">暂无已保存配置</p>
                ) : cfgRows.map((r) => (
                  <button key={r.id} className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent" onClick={() => doLoadFromList(r.id, r.name)}>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.deviceType}{r.deviceName ? ' / ' + r.deviceName : ''}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{fmtTime(r.updatedAt)}</span>
                  </button>
                ))}
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setShowLoad(false)}>关闭</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
