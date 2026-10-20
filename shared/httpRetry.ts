/** Retry-After is either whole seconds or an HTTP date. Never echo the supplied header. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isSafeInteger(ms) && Number.isSafeInteger(now + ms) ? ms : null;
  }
  if (/^[\d.+-]+$/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
