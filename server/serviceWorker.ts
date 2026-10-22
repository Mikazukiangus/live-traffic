type TimeoutPolicy = { request: number; speeds: number; assets: number };

/** The standalone worker receives only validated public numeric policy at build time. */
export function renderServiceWorker(source: string, timeouts: TimeoutPolicy): string {
  if (Object.values(timeouts).some((v) => !Number.isInteger(v) || v < 100 || v > 300000)) {
    throw new Error('Invalid service worker timeout policy');
  }
  const marker = "'__TRAFFICPULSE_NETWORK_TIMEOUTS__'";
  if (source.split(marker).length !== 2) throw new Error('Missing service worker timeout policy');
  return source.replace(marker, JSON.stringify(timeouts));
}
