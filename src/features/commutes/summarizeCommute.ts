import { minutesBetween } from '../../utils/ltaTravelTimes';
import { Commute, commuteCodes } from '../../utils/commutes';
import { MyCommuteProps } from './types';
const RAIN_RANK = { dry: 0, rain: 1, heavy: 2, thundery: 3 } as const;
export function summarizeCommute(
  commute: Commute,
  {
    routes,
    estimateMinutes,
    incidents,
    roadWorks,
    rain,
    lightning,
    floods,
  }: Pick<MyCommuteProps, 'routes' | 'estimateMinutes' | 'incidents' | 'roadWorks' | 'rain' | 'lightning' | 'floods'>,
) {
  const codes = commuteCodes(commute);
  const legs = commute.legs.map((leg) => {
    const route = routes.find((r) => r.code === leg.code && r.direction === leg.direction);
    const lta = route ? minutesBetween(route, leg.from, leg.to) : null;
    const est = lta == null ? estimateMinutes(leg.code) : null;
    return { leg, minutes: lta ?? est, estimated: lta == null };
  });
  const total = legs.every((l) => l.minutes != null) ? legs.reduce((sum, l) => sum + (l.minutes || 0), 0) : null;
  const anyEstimated = legs.some((l) => l.estimated);
  const onRoute = incidents.filter((i) => i.corridorCode && codes.includes(i.corridorCode));
  const works = codes.reduce((n, c) => n + (roadWorks[c]?.length || 0), 0);
  const worstRain = codes
    .map((c) => rain[c])
    .filter(Boolean)
    .sort((a, b) => RAIN_RANK[b.level] - RAIN_RANK[a.level])[0];
  const strikes = codes.reduce((n, c) => n + (lightning[c] || 0), 0);
  const floodAlerts = [...new Map(codes.flatMap((c) => floods[c] || []).map((f) => [f.id, f])).values()];
  return { codes, legs, total, anyEstimated, onRoute, works, worstRain, strikes, floodAlerts };
}
