import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { doAction, mcpCall } from '@/lib/api';

export function RulesTab() {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    id: '', desc: '', char: '2ad9', opcode: '', action: 'indicate',
    respChar: '', respHex: '', paramKey: '', paramOff: '', paramLen: '2', paramSigned: false, paramScale: '1',
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const buildRule = () => {
    const a: Record<string, unknown> = { type: f.action };
    if (f.action !== 'update_param') {
      a.characteristicUuid = f.respChar || undefined;
      a.responseHex = f.respHex || undefined;
    } else {
      a.paramKey = f.paramKey || undefined;
      a.paramByteOffset = f.paramOff === '' ? null : Number(f.paramOff);
      a.paramByteLength = Number(f.paramLen) || 2;
      a.paramSigned = f.paramSigned;
      a.paramScale = Number(f.paramScale) || 1;
    }
    return {
      id: f.id, description: f.desc || 'Dashboard 规则',
      trigger: { characteristicUuid: f.char || '2ad9', opcodeHex: f.opcode.trim() || null },
      action: a,
    };
  };

  const setRule = () => {
    if (!f.id.trim()) { toastError('需要规则 ID'); return; }
    setBusy(true);
    doAction(() => mcpCall('ble_set_interaction', buildRule()), { loading: '设置规则…', success: '规则已设置' }).finally(() => setBusy(false));
  };

  const clearRules = () => {
    setBusy(true);
    doAction(() => mcpCall('ble_clear_interactions'), { loading: '清除规则…', success: '已清除全部规则' }).finally(() => setBusy(false));
  };

  return (
    <Card>
      <CardHeader><CardTitle>设置交互规则 (ble_set_interaction)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="规则 ID"><Input value={f.id} placeholder="如 accept-power-target" onChange={(e) => set('id', e.target.value)} /></Field>
          <Field label="描述"><Input value={f.desc} placeholder="规则说明" onChange={(e) => set('desc', e.target.value)} /></Field>
          <Field label="触发特征 UUID"><Input value={f.char} onChange={(e) => set('char', e.target.value)} /></Field>
          <Field label="触发 Opcode（十六进制，空=全部）"><Input value={f.opcode} placeholder="如 05" onChange={(e) => set('opcode', e.target.value)} /></Field>
          <Field label="动作类型">
            <Select value={f.action} onValueChange={(v) => set('action', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="indicate">indicate 响应</SelectItem>
                <SelectItem value="notify">notify 响应</SelectItem>
                <SelectItem value="update_param">更新参数</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {f.action !== 'update_param' ? (
            <>
              <Field label="响应特征 UUID"><Input value={f.respChar} placeholder="如 2ad9" onChange={(e) => set('respChar', e.target.value)} /></Field>
              <Field label="响应数据 Hex"><Input value={f.respHex} placeholder="如 800501" onChange={(e) => set('respHex', e.target.value)} /></Field>
            </>
          ) : (
            <>
              <Field label="参数键"><Input value={f.paramKey} placeholder="如 powerWatts" onChange={(e) => set('paramKey', e.target.value)} /></Field>
              <Field label="字节偏移（空=raw）"><Input type="number" value={f.paramOff} placeholder="如 1" onChange={(e) => set('paramOff', e.target.value)} /></Field>
              <Field label="字节长度 1/2/4"><Input type="number" value={f.paramLen} onChange={(e) => set('paramLen', e.target.value)} /></Field>
              <div className="flex items-center gap-2"><Checkbox checked={f.paramSigned} onCheckedChange={(c) => set('paramSigned', !!c)} /><Label>有符号</Label></div>
              <Field label="缩放系数"><Input type="number" step="0.1" value={f.paramScale} onChange={(e) => set('paramScale', e.target.value)} /></Field>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={setRule}>设置规则</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={busy}>清除全部规则</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认清除全部交互规则？</AlertDialogTitle>
                <AlertDialogDescription>此操作将移除所有自定义交互规则，不可撤销。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={clearRules}>确认清除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function toastError(msg: string) {
  import('sonner').then(({ toast }) => toast.error(msg));
}
