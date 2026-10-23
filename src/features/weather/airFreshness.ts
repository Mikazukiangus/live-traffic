import { config } from '../../../config/client';
import { parseSgt } from '../../../shared/time';
import { sgtClock, type StaleFeed } from '../../utils/freshness';
import type { AirQuality } from '../../utils/airQuality';
import type { FeedState } from '../feeds/polledResource';

export type AirQualityFeed = FeedState<AirQuality>;
export const airObservationTime = (timestamp: string | null) => {
  const at = parseSgt(timestamp);
  return at === null ? 'unavailable' : `${sgtClock(at)} SGT`;
};

/** Request state and the two published observation times are independent evidence of freshness. */
export function airNotices(feed: AirQualityFeed, now: number): StaleFeed[] {
  if (!feed.data) return feed.status === 'loading' ? [] : [{ label: 'NEA air quality', detail: 'unavailable; retrying automatically' }];
  const notices: StaleFeed[] = [];
  if (feed.offline) notices.push({ label: 'NEA air quality', detail: 'offline copy; showing saved readings' });
  else if (feed.status === 'error') notices.push({ label: 'NEA air quality', detail: 'refresh failed; showing last received readings' });
  const observations = [
    { label: 'NEA PSI', timestamp: feed.data.psiTimestamp, available: feed.data.regions.some(r => r.psi24h !== null) },
    { label: 'NEA PM2.5', timestamp: feed.data.pm25Timestamp, available: feed.data.regions.some(r => r.pm25OneHour !== null) },
  ];
  for (const observation of observations) {
    const at = parseSgt(observation.timestamp);
    if (at === null || !observation.available) notices.push({ label: observation.label, detail: 'unavailable; other readings may still be shown' });
    else if (now - at >= config.freshness.air) notices.push({ label: observation.label, detail: `outdated; observation from ${sgtClock(at)} SGT` });
  }
  return notices;
}

export function airStatusText(feed: AirQualityFeed, now: number): string | null {
  if (!feed.data) return feed.status === 'loading' ? 'Loading NEA air quality…' : 'NEA air quality unavailable. Retrying automatically.';
  return airNotices(feed, now).map(n => `${n.label}: ${n.detail}`).join(' · ') || null;
}
