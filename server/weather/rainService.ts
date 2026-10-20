import { isRainForecast, rainIsValid, type RainForecast } from '../../shared/weather/rain.ts';
import { parseSgt } from '../../shared/time.ts';
import { DataGovHttpError } from '../providers/dataGovClient.ts';

interface Dependencies {
  fetch: () => Promise<unknown>;
  now: () => number;
  ttlMs: number;
  maxRetainedMs: number;
  onFailure: (error: unknown) => void;
}
export interface RainResult {
  data: RainForecast;
  cacheSeconds: number;
}

export function normalizeRain(data: any): RainForecast {
  const item = data?.items?.[0];
  const forecasts = new Map<string, string>((item?.forecasts ?? []).map((f: any) => [f.area, f.forecast]));
  const result = {
    success: true,
    source: 'nea_two_hr_forecast',
    issuedAt: item?.timestamp,
    updatedAt: item?.update_timestamp,
    validPeriod: item?.valid_period,
    areas: (data?.area_metadata ?? [])
      .filter((a: any) => forecasts.has(a.name))
      .map((a: any) => ({
        name: a.name,
        lat: a.label_location?.latitude,
        lon: a.label_location?.longitude,
        forecast: forecasts.get(a.name),
      })),
  };
  if (!isRainForecast(result)) throw new Error('Unexpected forecast payload');
  return result;
}

/** Cache and pending work belong to this function instance. Retention never extends provider validity. */
export function createRainService(deps: Dependencies) {
  let cached: { data: RainForecast; at: number } | null = null;
  let pending: Promise<RainResult> | null = null;
  let retryAt = 0;
  const current = (): RainResult => {
    const now = deps.now();
    const data = cached!.data;
    return {
      data,
      cacheSeconds: Math.max(
        0,
        Math.floor(Math.min(deps.ttlMs - (now - cached!.at), (parseSgt(data.validPeriod.end) ?? now) - now) / 1000),
      ),
    };
  };
  const retained = (): RainResult | null => {
    if (!cached || !rainIsValid(cached.data, deps.now()) || deps.now() - cached.at > deps.maxRetainedMs) return null;
    return {
      data: {
        ...cached.data,
        delivery: {
          state: 'retained',
          fetchedAt: new Date(cached.at).toISOString(),
          ...(retryAt > deps.now() ? { retryAt } : {}),
        },
      },
      cacheSeconds: 0,
    };
  };
  function get(): Promise<RainResult> {
    if (cached && rainIsValid(cached.data, deps.now()) && deps.now() - cached.at < deps.ttlMs)
      return Promise.resolve(current());
    if (pending) return pending;
    if (retryAt > deps.now()) {
      const fallback = retained();
      return fallback ? Promise.resolve(fallback) : Promise.reject(new DataGovHttpError(429, retryAt));
    }
    pending = (async () => {
      try {
        const data = normalizeRain(await deps.fetch());
        if (!rainIsValid(data, deps.now())) throw new Error('Forecast outside validity period');
        const at = deps.now();
        cached = { at, data: { ...data, delivery: { state: 'current', fetchedAt: new Date(at).toISOString() } } };
        retryAt = 0;
        return current();
      } catch (error) {
        retryAt = error instanceof DataGovHttpError ? (error.retryAt ?? 0) : 0;
        const fallback = retained();
        if (!fallback) throw error;
        deps.onFailure(error);
        return fallback;
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return { get };
}
