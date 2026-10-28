const PAGES = ['cameras', 'radar', 'sos', 'courier', 'unknown'] as const;
const ROUTES = ['traffic', 'trafficimages', 'trafficflow', 'vms', 'traveltimes', 'expresswayspeeds', 'rainforecast', 'forecast24h', 'airquality', 'health', 'imageproxy', 'live', 'carparks', 'roadconditions', 'weatheralerts', 'floods', 'auth', 'errors', 'unknown'] as const;
const member = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
export const isErrorId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const safeRelease = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : 'unknown';
export const safePage = (value: unknown) => member(PAGES, value) ? value : 'unknown';
export const safeRoute = (value: unknown) => member(ROUTES, value) ? value : 'unknown';
export type ErrorPage = typeof PAGES[number];
export type LogUser = { status: 'unverified' | 'anonymous' | 'authenticated' | 'unavailable'; id?: string };
export type ErrorContext = { requestId?: string; route?: string; method?: string; release?: string; environment?: string; page?: string; user?: LogUser };

export function safeContext(input: ErrorContext) {
  try {
    const { requestId, route, method, release, environment, page, user } = input;
    const submittedStatus = user?.status;
    const status = member(['unverified', 'anonymous', 'authenticated', 'unavailable'] as const, submittedStatus) ? submittedStatus : 'unverified';
    const id = user?.id;
    return {
      ...(isErrorId(requestId) ? { requestId } : {}),
      route: safeRoute(route), method: member(['GET', 'POST', 'OPTIONS'] as const, method) ? method : 'unknown',
      release: safeRelease(release),
      environment: member(['production', 'preview', 'development', 'test'] as const, environment) ? environment : 'development',
      page: safePage(page),
      user: status === 'authenticated' && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)
        ? { status, id } : { status: status === 'authenticated' ? 'unavailable' : status },
    };
  } catch {
    return { route: 'unknown' as const, method: 'unknown' as const, release: 'unknown', environment: 'development' as const,
      page: 'unknown' as const, user: { status: 'unverified' as const } };
  }
}
