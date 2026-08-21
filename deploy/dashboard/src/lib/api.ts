import { Toaster } from 'sonner';

/** MCP JSON-RPC 调用（经同源 /mcp 反代） */
export async function mcpCall(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  const payload = lines.length ? lines[lines.length - 1] : text.trim();
  const obj = JSON.parse(payload);
  if (obj.error) throw new Error(obj.error.message || JSON.stringify(obj.error));
  const content = obj.result?.content?.[0];
  if (!content) throw new Error('空响应');
  return content.text || '';
}

/** 执行操作并 toast 结果 */
export async function doAction(
  fn: () => Promise<string>,
  opts: { loading?: string; success?: string },
): Promise<string | null> {
  const { toast } = await import('sonner');
  toast.loading(opts.loading ?? '处理中…');
  try {
    const text = await fn();
    toast.dismiss();
    toast.success(opts.success ?? '操作成功', { description: text.split('\n').slice(0, 6).join('\n') });
    return text;
  } catch (e) {
    toast.dismiss();
    toast.error('操作失败', { description: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
