import { useSyncExternalStore } from 'react';
import { trendOf } from '../../utils/commuteHistory';
import { getCommuteRepository } from './commuteStorage';

export function useCommuteHistory(id: string, routeKey: string, now: number) {
  const repository = getCommuteRepository();
  useSyncExternalStore(repository.subscribe, repository.getSnapshot);
  // Always select from the current route, even before effects or while feeds are unavailable.
  const samples = repository.samples(id, routeKey);
  return { samples, trend: trendOf(samples, now) };
}
