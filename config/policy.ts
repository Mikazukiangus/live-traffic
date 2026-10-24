/** Shared security and protocol policy; changes are reviewed in source control, not env overrides. */
export const IMAGE_PROXY_HOSTS = Object.freeze([
  'images.data.gov.sg', 'datamall2.mytransport.sg', 'datamall.lta.gov.sg',
  'dm-traffic-camera-itsc.s3.ap-southeast-1.amazonaws.com',
]);

/** Public pagination protocol bounds; offsets are list positions, never a database cursor. */
export const LIST_PAGINATION = Object.freeze({ defaultLimit: 100, maxLimit: 500, maxOffset: 1_000_000 });
export const LIVE_COLLECTIONS = {
  carparks: ['carParks'], roadconditions: ['roadWorks', 'faultyLights'],
  weatheralerts: ['strikes', 'heatStations'], floods: ['alerts'],
} as const;
