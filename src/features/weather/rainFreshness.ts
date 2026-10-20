import { parseSgt } from '../../../shared/time';
import { rainIsValid } from '../../../shared/weather/rain';
import type { RainState } from './rainResource';
import type { StaleFeed } from '../../utils/freshness';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });
export function rainNotice(feed: RainState, now: number): StaleFeed | null {
  const data = feed.data;
  const end = parseSgt(data?.validPeriod.end);
  if (data && !rainIsValid(data, now))
    return {
      label: 'NEA rain forecast',
      detail:
        end !== null && end <= now
          ? `expired at ${clock(end)} SGT; waiting for a newer forecast`
          : 'not valid for this time',
    };
  if (feed.status === 'error' || data?.delivery?.state === 'retained')
    return {
      label: 'NEA rain forecast',
      detail: data
        ? `retained forecast issued ${clock(parseSgt(data.issuedAt)!)} SGT; refresh unavailable`
        : 'unavailable; retrying',
    };
  return null;
}
