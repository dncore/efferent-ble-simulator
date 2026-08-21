import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mcpCall } from '@/lib/api';
import { fmtTime } from '@/lib/time';

// 把文本中的 UTC 时间（2026-08-20 05:24:56）替换为本地时区显示
function fmtLineTimes(text: string): string {
  return text.replace(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/g, (m) => fmtTime(m));
}

interface SessionRow { id: string; line: string }

export function SessionsTab() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [detail, setDetail] = useState('选择会话查看详情');
  const [selId, setSelId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const text = await mcpCall('ble_list_sessions');
      const lines = text.split('\n').filter((l) => l.includes('#'));
      setRows(lines.map((line) => ({ id: (line.match(/#(\d+)/) ?? [])[1] ?? '?', line: fmtLineTimes(line) })));
    } catch (e) { setRows([]); }
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  const getSession = async (id: string) => {
    setBusy(true);
    try {
      const text = await mcpCall('ble_get_session', { id: Number(id) });
      setDetail(fmtLineTimes(text));
    } catch (e) { setDetail('加载失败: ' + (e instanceof Error ? e.message : e)); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>历史会话 (ble_list_sessions)</CardTitle>
          <Button size="sm" variant="outline" disabled={busy} onClick={load}>刷新</Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无会话记录</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead className="w-16">ID</TableHead><TableHead>会话</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => { setSelId(r.id); getSession(r.id); }}>
                    <TableCell className="font-medium">#{r.id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.line}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>会话详情 (ble_get_session)</CardTitle>
          <div className="flex gap-2">
            <Input className="h-8 w-28" type="number" placeholder="Session ID" value={selId} onChange={(e) => setSelId(e.target.value)} />
            <Button size="sm" variant="outline" disabled={busy || !selId} onClick={() => getSession(selId)}>查看</Button>
          </div>
        </CardHeader>
        <CardContent><pre className="max-h-[400px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">{detail}</pre></CardContent>
      </Card>
    </div>
  );
}
