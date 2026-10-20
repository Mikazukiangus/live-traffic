/** Provider timestamps without an offset are Singapore time, not the machine's local time. */
export function parseSgt(timestamp: string | null | undefined): number | null {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return null;
  let iso = timestamp.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += '+08:00';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
