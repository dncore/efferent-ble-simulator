/** 时间解析与本地时区格式化工具
 *
 * 后端时间字符串可能是：
 *   - ISO 带 Z：  "2026-08-20T05:52:42.651Z"        (startedAt.toISOString)
 *   - UTC 无标记： "2026-08-20T08:43:00.012"         (connection_logs strftime)
 *   - UTC 空格：  "2026-08-20 08:34:35"              (sessions/saved_configs datetime)
 * 统一视为 UTC 解析，输出当前用户时区的本地时间。
 */

function parse(input: string): Date | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  // "2026-08-20 08:34:35" → "2026-08-20T08:34:35"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  // 无时区标记（无 Z 也无 +08:00 等）→ 视为 UTC
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 完整本地时间：2026-08-20 16:43:00 */
export function fmtTime(input: string): string {
  const d = parse(input);
  if (!d) return input || '—';
  return d.toLocaleString('zh-CN', {
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** 仅本地时分秒：16:43:00 */
export function fmtTimeHM(input: string): string {
  const d = parse(input);
  if (!d) return input || '—';
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
