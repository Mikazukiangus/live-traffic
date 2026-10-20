import type { ReferenceArea } from '../geography/coordinates.ts';
import { parseSgt } from '../time.ts';

export interface ForecastArea extends ReferenceArea {
  forecast: string;
}
export interface RainForecast {
  issuedAt: string;
  updatedAt?: string;
  validPeriod: { start: string; end: string; text: string };
  areas: ForecastArea[];
  delivery?: { state: 'current' | 'retained'; fetchedAt: string; retryAt?: number };
}
export function isRainForecast(value: unknown): value is RainForecast {
  const d = value as RainForecast | null;
  const start = parseSgt(d?.validPeriod?.start),
    end = parseSgt(d?.validPeriod?.end);
  return (
    !!d &&
    typeof d.issuedAt === 'string' &&
    parseSgt(d.issuedAt) !== null &&
    start !== null &&
    end !== null &&
    start < end &&
    typeof d.validPeriod.text === 'string' &&
    Array.isArray(d.areas) &&
    d.areas.length > 0 &&
    d.areas.every(
      (a) =>
        a &&
        typeof a.name === 'string' &&
        a.name.trim().length > 0 &&
        typeof a.forecast === 'string' &&
        a.forecast.trim().length > 0 &&
        Number.isFinite(a.lat) &&
        a.lat >= -90 &&
        a.lat <= 90 &&
        Number.isFinite(a.lon) &&
        a.lon >= -180 &&
        a.lon <= 180,
    ) &&
    (d.delivery === undefined ||
      (!!d.delivery &&
        ['current', 'retained'].includes(d.delivery.state) &&
        typeof d.delivery.fetchedAt === 'string' &&
        parseSgt(d.delivery.fetchedAt) !== null &&
        (d.delivery.retryAt === undefined || (Number.isSafeInteger(d.delivery.retryAt) && d.delivery.retryAt >= 0))))
  );
}
export function rainIsValid(data: RainForecast, now: number): boolean {
  const start = parseSgt(data.validPeriod.start),
    end = parseSgt(data.validPeriod.end);
  return start !== null && end !== null && start <= now && now < end;
}
