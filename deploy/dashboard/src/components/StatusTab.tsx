import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { doAction, mcpCall } from '@/lib/api';
import { STATE_MAP, PHASE_MAP } from '@/lib/schemas';
import { fmtTime } from '@/lib/time';
import { formBus } from '@/lib/formBus';

interface StatusData {
  state: string;
  adapter: string;
  session: string;
  started: string;
  configText: string;
  live: { k: string; v: string }[];
}

function parseStatus(text: string): StatusData {
  const lines = text.split('\n');
  const get = (k: string) => { const l = lines.find((x) => x.startsWith(k + ':')); return l ? l.slice(k.length + 1).trim() : '—'; };
  const cfgIdx = lines.findIndex((l) => l.includes('当前配置'));
  const liveIdx = lines.findIndex((l) => l.includes('设备运行状态'));
  const live: { k: string; v: string }[] = [];
  if (liveIdx >= 0) {
    for (const line of lines.slice(liveIdx + 1)) {
      if (!line.trim()) continue;
      for (const kv of line.split('|')) {
        const m = kv.trim().match(/^(.+?):\s*(.+)$/);
        if (m) live.push({ k: m[1], v: m[2] });
      }
    }
  }
  return {
    state: get('状态'), adapter: get('适配器'), session: get('Session ID'), started: get('启动时间'),
    configText: cfgIdx >= 0 ? lines.slice(cfgIdx + 1).join('\n') : '模拟器未运行（暂无配置）',
    live,
  };
}

const quickArgs = {
  deviceType: 'ftms',
  ftms: {
    speedKph: 25, cadenceRpm: 80, powerWatts: 150, baseHeartRate: 120, notifyIntervalMs: 500,
    resistanceLevel: 10, grade: 0, minResistance: 1, maxResistance: 100, minPower: 0, maxPower: 4000,
    simulation: {
      enabled: true, riderWeightKg: 75, bikeWeightKg: 8, crr: 0.004, cdA: 0.35,
      fatigueFactor: 0.0005, cadenceCoupling: 'proportional', microPauseProbability: 0.008,
      scenario: { type: 'ride_script', repeat: true }, autoStart: true,
    },
  },
  notes: 'Dashboard 快速启动',
};

export function StatusTab() {
  const [data, setData] = useState<StatusData | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const text = await mcpCall('ble_status');
      setData(parseStatus(text));
      setOnline(true);
    } catch {
      setOnline(false);
      setData(null);
    }
  };

  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, []);

  const quick = (name: string, label: string) => {
    setBusy(true);
    doAction(() => mcpCall(name, name === 'ble_start' ? quickArgs : {}), { loading: label, success: label })
      .then(() => { if (name === 'ble_start') formBus.set(quickArgs as unknown as Record<string, unknown>); refresh(); })
      .finally(() => setBusy(false));
  };

  const stateBadge = !online ? <Badge variant="danger">模拟 —</Badge>
    : data?.state === 'running' ? <Badge variant="success">模拟运行中</Badge>
    : <Badge variant="secondary">模拟已停止</Badge>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>MCP 服务状态</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <Row k="MCP 服务" v={online ? '在线' : '离线'} />
          <Row k="运行方式" v="Docker · 持续运行" />
          <Row k="端点" v="/mcp（同源反代）" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>模拟设备状态</CardTitle>{stateBadge}</CardHeader>
        <CardContent className="space-y-1">
          <Row k="运行状态" v={data ? (data.state === 'running' ? '运行中' : data.state === 'stopped' ? '已停止' : data.state) : '—'} />
          <Row k="适配器" v={data?.adapter ?? '—'} />
          <Row k="Session" v={data?.session ?? '—'} />
          <Row k="启动时间" v={data && data.started && data.started !== '—' ? fmtTime(data.started) : '—'} />
          {data && data.live.length > 0 && (
            <div className="mt-1 rounded-md border p-1.5">
              {data.live.map((l) => <Row key={l.k} k={l.k} v={l.v} />)}
            </div>
          )}
          {online && data && data.live.length === 0 && (
            <p className="text-xs text-muted-foreground">模拟器未运行（通过下方按钮或「模拟控制」页启动）</p>
          )}
          {!online && <p className="text-xs text-destructive">MCP 服务离线，无法获取模拟设备状态</p>}
          <div className="flex gap-2 pt-1.5">
            <Button size="sm" disabled={busy} onClick={() => quick('ble_start', '正在启动骑行剧本')}>启动骑行剧本</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => quick('ble_stop', '正在停止')}>停止</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>当前配置</CardTitle></CardHeader>
        <CardContent><pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{data?.configText ?? '模拟器未运行（暂无配置）'}</pre></CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-1 text-[13px] last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
