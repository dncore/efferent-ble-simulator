import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, Eye, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { mcpCall } from '@/lib/api';
import { formBus } from '@/lib/formBus';
import { DEVICE_TYPE_LABELS } from '@/lib/schemas';
import { fmtTime } from '@/lib/time';

interface CfgRow { id: number; name: string; deviceType: string; deviceName: string; updatedAt: string }

export function ConfigsTab() {
  const [rows, setRows] = useState<CfgRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [rename, setRename] = useState<CfgRow | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [loadTarget, setLoadTarget] = useState<CfgRow | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      const text = await mcpCall('ble_list_configs');
      // 解析 "共 N/20 条已保存配置:" + "#id [name] type / devName | 更新: ts"
      const lines = text.split('\n').filter((l) => l.trim().startsWith('#'));
      setRows(lines.map((l) => {
        const id = Number((l.match(/#(\d+)/) ?? [])[1] ?? 0);
        const name = (l.match(/\[([^\]]+)\]/) ?? [])[1] ?? '';
        const dt = (l.match(/\]\s+([a-z_]+)/) ?? [])[1] ?? '';
        const dn = (l.match(/\/([^|]+?)\s*\|/) ?? [])[1]?.trim() ?? '';
        const ts = (l.match(/\|\s*更新:\s*(.+)$/) ?? [])[1]?.trim() ?? '';
        return { id, name, deviceType: dt, deviceName: dn, updatedAt: ts };
      }));
    } catch (e) { setRows([]); }
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  const viewDetail = async (r: CfgRow) => {
    try {
      const json = await mcpCall('ble_get_config_detail', { id: r.id });
      setView(json);
    } catch (e) { toast.error('查看失败', { description: e instanceof Error ? e.message : String(e) }); }
  };

  const doRename = async () => {
    if (!rename || !renameVal.trim()) return;
    try { await mcpCall('ble_rename_config', { id: rename.id, name: renameVal.trim() }); toast.success('已重命名'); setRename(null); load(); }
    catch (e) { toast.error('重命名失败', { description: e instanceof Error ? e.message : String(e) }); }
  };

  const doDelete = async (r: CfgRow) => {
    try { await mcpCall('ble_delete_config', { id: r.id }); toast.success(`已删除「${r.name}」`); load(); }
    catch (e) { toast.error('删除失败', { description: e instanceof Error ? e.message : String(e) }); }
  };

  const doLoad = async (r: CfgRow) => {
    setLoadTarget(r);
    try {
      const json = await mcpCall('ble_get_config_detail', { id: r.id });
      const parsed = JSON.parse(json);
      if (parsed.config) formBus.set(parsed.config);
      toast.success(`已载入「${r.name}」到表单`, { description: '可在「模拟控制」页调整后点击启动 / 保存配置生效' });
    } catch (e) { toast.error('载入失败', { description: e instanceof Error ? e.message : String(e) }); }
    setLoadTarget(null);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>配置列表（用户保存的命名配置，上限 20）</CardTitle>
        <Button size="sm" variant="outline" disabled={busy} onClick={load}>刷新</Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无已保存配置。在「模拟控制」页点「保存配置」创建。</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead className="w-14">ID</TableHead><TableHead>名称</TableHead><TableHead>设备类型</TableHead><TableHead>更新时间</TableHead><TableHead className="text-right">操作</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">#{r.id}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{DEVICE_TYPE_LABELS[r.deviceType as keyof typeof DEVICE_TYPE_LABELS] ?? (r.deviceType || '—')}</Badge>
                    {r.deviceName && <span className="ml-2 text-xs text-muted-foreground">{r.deviceName}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtTime(r.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => viewDetail(r)}><Eye className="h-3.5 w-3.5" /> 查看</Button>
                      <Button size="sm" variant="outline" disabled={!!loadTarget} onClick={() => doLoad(r)}><Upload className="h-3.5 w-3.5" /> 载入</Button>
                      <Button size="sm" variant="outline" onClick={() => { setRename(r); setRenameVal(r.name); }}><Pencil className="h-3.5 w-3.5" /> 重命名</Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive"><Trash2 className="h-3.5 w-3.5" /> 删除</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认删除配置「{r.name}」？</AlertDialogTitle>
                            <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => doDelete(r)}>确认删除</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* 查看详情 */}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>配置详情</DialogTitle><DialogDescription>完整配置 JSON</DialogDescription></DialogHeader>
          <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{view}</pre>
          <DialogFooter><Button variant="outline" onClick={() => setView(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>重命名配置</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>配置名称</Label>
            <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(null)}>取消</Button>
            <Button onClick={doRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
