/**
 * Recent travel times for each saved commute, so its card can say whether traffic is building or
 * easing. LTA publishes only the current estimate, so the history is what this browser has seen
 * while TrafficPulse was open: one sample per LTA update, kept for 3 hours.
 */
const KEY = 'trafficpulse.commuteHistory';
const KEEP_MS = 3 * 60 * 60_000;
// LTA updates travel times every 5 minutes; don't record the same update twice.
const MIN_GAP_MS = 4 * 60_000;

export type Sample = [at: number, minutes: number];
type History = Record<string, Sample[]>;

const read = (): History => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** Adds a sample (dropping old ones) and returns the commute's samples, oldest first. */
export function recordSample(commuteId: string, minutes: number, at = Date.now()): Sample[] {
  const all = read();
  const samples = (all[commuteId] || []).filter(([t]) => at - t <= KEEP_MS);
  const last = samples[samples.length - 1];
  if (!last || (at - last[0] >= MIN_GAP_MS) || (last[1] !== minutes && at - last[0] >= 60_000)) samples.push([at, minutes]);
  all[commuteId] = samples;
  // Forget commutes that haven't been seen for a while.
  for (const id of Object.keys(all)) if (!all[id].length || at - all[id][all[id].length - 1][0] > KEEP_MS) delete all[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage blocked; the trend simply won't show
  }
  return samples;
}

export function forgetCommute(commuteId: string) {
  const all = read();
  delete all[commuteId];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage blocked
  }
}

export type TrendDirection = 'building' | 'easing' | 'steady';

export interface Trend {
  direction: TrendDirection;
  // Change in minutes since `since`
  change: number;
  since: number;
}

// Compare with the sample nearest 30 minutes ago, if there is one 15–60 minutes back.
const LOOKBACK_MS = 30 * 60_000;
const MIN_BACK_MS = 15 * 60_000;
const MAX_BACK_MS = 60 * 60_000;
// Changes of a minute or two are LTA rounding, not a trend.
const THRESHOLD_MIN = 3;

export function trendOf(samples: Sample[], now = Date.now()): Trend | null {
  if (samples.length < 2) return null;
  const [latestAt, latest] = samples[samples.length - 1];
  const earlier = samples
    .filter(([t]) => latestAt - t >= MIN_BACK_MS && latestAt - t <= MAX_BACK_MS)
    .sort((a, b) => Math.abs(latestAt - a[0] - LOOKBACK_MS) - Math.abs(latestAt - b[0] - LOOKBACK_MS))[0];
  if (!earlier || now - latestAt > MAX_BACK_MS) return null;
  const change = latest - earlier[1];
  const direction: TrendDirection = change >= THRESHOLD_MIN ? 'building' : change <= -THRESHOLD_MIN ? 'easing' : 'steady';
  return { direction, change, since: earlier[0] };
}
