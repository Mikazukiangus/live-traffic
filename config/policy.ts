/** Shared security and protocol policy; changes are reviewed in source control, not env overrides. */
export const IMAGE_PROXY_HOSTS = Object.freeze([
  'images.data.gov.sg', 'datamall2.mytransport.sg', 'datamall.lta.gov.sg',
  'dm-traffic-camera-itsc.s3.ap-southeast-1.amazonaws.com',
]);

/** Public pagination protocol bounds; offsets are list positions, never a database cursor. */
export const LIST_PAGINATION = Object.freeze({ defaultLimit: 100, maxLimit: 500, maxOffset: 1_000_000 });

/** Reporting is best effort, bounded and never retries a failed telemetry POST. */
export const ERROR_TRACKING = Object.freeze({ bodyBytes: 2048, timeoutMs: 3000,
  windowMs: 60_000, browserBudget: 10, instanceBudget: 60, maxLocations: 3 });
export const LIVE_COLLECTIONS = {
  carparks: ['carParks'], roadconditions: ['roadWorks', 'faultyLights'],
  weatheralerts: ['strikes', 'heatStations'], floods: ['alerts'], forecast24h: ['periods'],
} as const;
