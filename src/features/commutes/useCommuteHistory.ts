import { useEffect, useSyncExternalStore } from 'react';
import { recordSample, trendOf } from '../../utils/commuteHistory';
import { getCommuteRepository } from './commuteStorage';

export function useCommuteHistory(
  id: string,
  routeKey: string,
  total: number | null,
  anyEstimated: boolean,
  travelStatus: 'loading' | 'live' | 'error',
  travelFetchedAt: number | null,
  now: number,
) {
  const repository = getCommuteRepository();
  useSyncExternalStore(repository.subscribe, repository.getSnapshot);
  // Always select from the current route, even before effects or while feeds are unavailable.
  const samples = repository.samples(id, routeKey);
  useEffect(() => {
    if (travelStatus === 'live' && travelFetchedAt != null && total != null && !anyEstimated) {
      recordSample(id, routeKey, total, travelFetchedAt);
    }
  }, [id, routeKey, total, anyEstimated, travelFetchedAt, travelStatus]);
  return { samples, trend: trendOf(samples, now) };
}
