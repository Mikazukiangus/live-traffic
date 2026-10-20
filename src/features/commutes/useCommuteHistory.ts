import { useState, useEffect } from 'react';
import { recordSample, trendOf, type Sample } from '../../utils/commuteHistory';
export function useCommuteHistory(
  id: string,
  total: number | null,
  anyEstimated: boolean,
  travelStatus: 'loading' | 'live' | 'error',
  travelFetchedAt: number | null,
  now: number,
) {
  // Travel time history for the trend; only LTA times count (estimates move with speed, not time).
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => {
    if (travelStatus === 'live' && travelFetchedAt != null && total != null && !anyEstimated) {
      setSamples(recordSample(id, total, travelFetchedAt));
    }
  }, [id, total, anyEstimated, travelFetchedAt, travelStatus]);
  const trend = trendOf(samples, now);

  return { samples, trend };
}
