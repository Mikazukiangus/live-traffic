/** Recent live travel-time receipts for one exact ordered route, retained for three hours. */
import { getCommuteRepository } from '../features/commutes/commuteStorage';
import type { Sample } from '../../shared/commutes/model';
export type { Sample } from '../../shared/commutes/model';
export const recordSample = (id: string, routeKey: string, minutes: number, at?: number) =>
  getCommuteRepository().record(id, routeKey, minutes, at);
export const readSamples = (id: string, routeKey: string) => getCommuteRepository().samples(id, routeKey);
export const forgetCommute = (id: string) => getCommuteRepository().forget(id);

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
  const direction: TrendDirection =
    change >= THRESHOLD_MIN ? 'building' : change <= -THRESHOLD_MIN ? 'easing' : 'steady';
  return { direction, change, since: earlier[0] };
}
