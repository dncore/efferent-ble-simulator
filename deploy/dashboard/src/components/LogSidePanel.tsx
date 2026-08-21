import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, RefreshCw, UnfoldVertical, FoldVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mcpCall } from '@/lib/api';
import { EVT_PRESETS, EVT_LABELS } from '@/lib/schemas';
import { fmtTime, fmtTimeHM } from '@/lib/time';
import { cn } from '@/lib/utils';

const LOG_RE = /^\[(.+?)\]\s+#(\d+)\s+session=(\S+)\s+\[(\w+)\](?:\s+char=(\S+))?(?:\s+data=(\S+))?\s?(.*)$/;

interface LogEntry { time: string; id: string; session: string; type: string; char: string; data: string; msg: string }
const LOG_COLORS: Record<string, string> = {
  simulator_start: 'info', simulator_stop: 'info', central_connected: 'success',
  central_disconnected: 'warning', write_received: 'info', indicate_sent: 'info',
  param_updated: 'info', error: 'danger',
};

const PANEL_MIN = 300, PANEL_MAX = 640, PANEL_DEFAULT = 420;

export function LogSidePanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [meta, setMeta] = useState('');
  const [filter, setFilter] = useState('key');
  const [limit, setLimit] = useState('50');
  const [allOpen, setAllOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('logPanelCollapsed') === '1');
  const [width, setWidth] = useState(() => Number(localStorage.getItem('logPanelWidth')) || PANEL_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setBusy(true);
    const args: Record<string, unknown> = { limit: Number(limit) };
    const preset = EVT_PRESETS[filter];
    if (preset) args.eventTypes = preset;
    try {
      const text = await mcpCall('ble_get_logs', args);
      const list: LogEntry[] = [];
      for (const line of text.split('\n').filter(Boolean)) {
        const m = line.match(LOG_RE);
        if (m) list.push({ time: m[1], id: m[2], session: m[3], type: m[4], char: m[5] || '', data: m[6] || '', msg: m[7] || '' });
      }
      setEntries(list);
      setMeta(text.split('\n').find((l) => l.startsWith('共 ')) || '');
    } catch { setEntries([]); setMeta('加载失败'); }
    setBusy(false);
  };
  useEffect(() => { load(); }, [filter, limit]);

  // 展开时给主内容留出右侧空间
  useEffect(() => {
    document.body.style.paddingRight = collapsed ? '44px' : width + 'px';
    return () => { document.body.style.paddingRight = ''; };
  }, [collapsed, width]);

  const toggle = () => {
    const c = !collapsed;
    setCollapsed(c);
    localStorage.setItem('logPanelCollapsed', c ? '1' : '0');
  };

  // 左缘拖动调宽
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelRef.current?.offsetWidth ?? width;
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const w = Math.min(PANEL_MAX, Math.max(PANEL_MIN, panelRef.current?.offsetWidth ?? width));
      setWidth(w);
      localStorage.setItem('logPanelWidth', String(w));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 收起态：右侧细条，仅一个展开按钮
  if (collapsed) {
    return (
      <div className="fixed right-0 top-0 z-50 flex h-full w-11 flex-col items-center border-l bg-card py-3 shadow-md">
        <button className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent" onClick={toggle} title="展开日志">
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground" style={{ writingMode: 'vertical-rl' }}>通信日志</span>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="fixed right-0 top-0 z-50 flex h-full flex-col border-l bg-card shadow-md" style={{ width }}>
      {/* 左缘拖动条：绝对定位，不参与 flex 布局（否则 h-full 会压扁日志列表） */}
      <div className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-muted/60 transition-colors hover:bg-accent" onMouseDown={onResizeStart} title="拖动调宽" />
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b pl-2 pr-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">通信日志</span>
        <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={toggle} title="收起"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(EVT_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={limit} onValueChange={setLimit}>
          <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['30', '50', '100'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="h-7 w-7 px-0" disabled={busy} onClick={load} title="刷新"><RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /></Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 px-0" onClick={() => setAllOpen((e) => !e)} title={allOpen ? '全部折叠' : '全部展开'}>
          {allOpen ? <FoldVertical className="h-3.5 w-3.5" /> : <UnfoldVertical className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto border-t">
        {entries.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">暂无匹配的日志记录</p>
        ) : entries.map((e, i) => {
          const open = allOpen || openSet.has(i);
          return (
            <div key={i} className="border-b last:border-0">
              <button className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-muted" onClick={() => setOpenSet((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
                <span className={cn('w-2 shrink-0 text-[9px] text-muted-foreground transition-transform', open && 'rotate-90')}>▶</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtTimeHM(e.time)}</span>
                <Badge variant={(LOG_COLORS[e.type] ?? 'secondary') as never} className="shrink-0 text-[9px] px-1.5">{e.type}</Badge>
                <span className="truncate">{e.msg || (e.char ? 'char=' + e.char : '#' + e.id)}</span>
              </button>
              {open && (
                <div className="px-5 pb-1.5 font-mono text-[10.5px] leading-relaxed text-slate-600">
                  <div>#{e.id} session={e.session} | {fmtTime(e.time)}</div>
                  {e.char && <div>特征: {e.char}</div>}
                  {e.data && <div>数据: <span className="break-all text-sky-700">{e.data}</span></div>}
                  {e.msg && <div>消息: {e.msg}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t px-2.5 py-1 text-[10px] text-muted-foreground">{meta}</div>
    </div>
  );
}
