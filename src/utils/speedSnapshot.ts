/**
 * The last good /api/expresswayspeeds answer, kept in this browser so the map and speeds can still
 * be shown (clearly marked with their time) while LTA's speed band feed is down.
 */
const KEY = 'trafficpulse.lastSpeeds';
// Older than this is no use even as a fallback.
const MAX_AGE_MS = 24 * 60 * 60_000;

export interface SpeedSnapshot {
  savedAt: number;
  json: any;
}

const round = (n: unknown) => (typeof n === 'number' ? Math.round(n * 1e5) / 1e5 : n);

export function saveSpeedSnapshot(json: any) {
  try {
    // Coordinates to 5 decimals (about 1 m) keep the copy small.
    const segments = Array.isArray(json?.segments)
      ? json.segments.map((s: unknown[]) => s.map((v, i) => (i >= 2 ? round(v) : v)))
      : undefined;
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), json: { ...json, segments } }));
  } catch {
    // Storage full or blocked; there is just no fallback
  }
}

export function loadSpeedSnapshot(now = Date.now()): SpeedSnapshot | null {
  try {
    const snap = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!snap?.json || typeof snap.savedAt !== 'number' || now - snap.savedAt > MAX_AGE_MS) return null;
    return snap;
  } catch {
    return null;
  }
}
