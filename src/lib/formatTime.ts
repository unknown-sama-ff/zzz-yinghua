/** Format an ISO timestamp as `YYYY-MM-DD HH:mm`. Defaults to the browser's local timezone;
 * pass a fixed IANA zone like 'Asia/Shanghai' (北京时间) when the display must not vary by viewer. */
export function formatTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '--';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!timeZone) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
