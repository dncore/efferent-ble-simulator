import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { doAction, mcpCall } from '@/lib/api';
import { RIDE_TEMPLATES, DEVICE_TEMPLATES, type Tmpl } from '@/lib/templates';
import { formBus } from '@/lib/formBus';

function TmplCard({ t, onFill }: { t: Tmpl; onFill: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:border-ring/50">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{t.name}</span>
        <Badge variant="outline" className="text-[10px]">{t.tag}</Badge>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => {
          setBusy(true);
          doAction(() => mcpCall('ble_start', t.args), { loading: '启动模板 ' + t.name, success: '模板已启动' }).finally(() => setBusy(false));
        }}>一键启动</Button>
        <Button size="sm" variant="outline" onClick={onFill}>填入表单</Button>
      </div>
    </div>
  );
}

export function TemplatesTab() {
  const fill = (t: Tmpl) => {
    formBus.set(t.args as Record<string, unknown>);
    toast.success('已填入模板「' + t.name + '」', { description: '可在「模拟控制」页调整后启动' });
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>骑行动作模板</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RIDE_TEMPLATES.map((t) => <TmplCard key={t.name} t={t} onFill={() => fill(t)} />)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>设备模板</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEVICE_TEMPLATES.map((t) => <TmplCard key={t.name} t={t} onFill={() => fill(t)} />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
