/** Canonical environment schema. This module never reads process.env or prints values. */
export type Environment = Record<string, string | boolean | undefined>;
type Scope = 'public' | 'server' | 'development' | 'tools' | 'ci';
type Field<T> = { scope: Scope; description: string; default: string; parse: (value: string) => T };
const field = <T>(scope: Scope, description: string, fallback: string, parse: (value: string) => T): Field<T> =>
  ({ scope, description, default: fallback, parse });
const integer = (scope: Scope, description: string, fallback: number, min = 1, max = 86_400_000) =>
  field(scope, description, String(fallback), (value) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
      throw new Error(`must be an integer from ${min} to ${max}`);
    return Number(value);
  });
const boolean = (scope: Scope, description: string, fallback: boolean) =>
  field(scope, description, String(fallback), (value) => {
    if (value !== 'true' && value !== 'false') throw new Error('must be true or false');
    return value === 'true';
  });
function parseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('must be an absolute HTTPS URL (HTTP allowed only on loopback for local tests)'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.hash || url.search)
    throw new Error('must use HTTPS, without credentials, query or fragment (loopback HTTP allowed)');
  return url.toString().replace(/\/$/, '');
}
const url = (scope: Scope, description: string, fallback: string) => field(scope, description, fallback, parseUrl);
const secret = (description: string) => field('server', description, '', (value) => {
  if (/[\r\n]/.test(value) || /^(YOUR_|MY_|REPLACE_|CHANGE_ME)/i.test(value)) throw new Error('must be a real key or empty for keyless mode');
  return value || null;
});
const poll = (description: string, fallback: number) => integer('public', description, fallback, 1000);

export const ENV_SCHEMA = {
  LTA_ACCOUNT_KEY: secret('Private LTA DataMall AccountKey. Empty keeps keyless camera/weather mode. Never prefix secrets with VITE_.'),
  LTA_API_KEY: secret('Legacy alias. LTA_ACCOUNT_KEY takes precedence; leave empty for new setups.'),
  LTA_BASE_URL: url('server', 'LTA provider base; credentials are sent here. Configure only a trusted provider.', 'https://datamall2.mytransport.sg/ltaodataservice'),
  DATA_GOV_BASE_URL: url('server', 'Keyless data.gov.sg v2 real-time API base.', 'https://api-open.data.gov.sg/v2/real-time/api'),
  REQUEST_TIMEOUT_MS: integer('server', 'LTA/image request timeout in milliseconds.', 15000, 100, 120000),
  DATA_GOV_TIMEOUT_MS: integer('server', 'Weather upstream request timeout in milliseconds.', 10000, 100, 120000),
  HEALTH_PROBE_TIMEOUT_MS: integer('server', 'Per-upstream health probe timeout in milliseconds.', 8000, 100, 120000),
  LTA_RETRY_DELAY_MS: integer('server', 'Linear LTA retry backoff in milliseconds.', 400, 0, 30000),
  LTA_MAX_ATTEMPTS: integer('server', 'Attempts per ordinary paginated LTA request.', 3, 1, 5),
  LTA_PAGE_CONCURRENCY: integer('server', 'Ordinary dataset concurrency; capped at 10 to avoid LTA overload.', 6, 1, 10),
  LTA_MAX_PAGES: integer('server', 'Safety cap for ordinary LTA datasets.', 40, 1, 2000),
  SPEED_PAGE_CONCURRENCY: integer('server', 'Speed-band concurrency; capped at 10 after observed upstream throttling.', 10, 1, 10),
  SPEED_MAX_ATTEMPTS: integer('server', 'Attempts per speed-band page.', 4, 1, 5),
  SPEED_MAX_PAGES: integer('server', 'Safety cap for the complete speed-band dataset.', 600, 1, 2000),
  SPEED_CACHE_TTL_MS: integer('server', 'In-process speed cache lifetime in milliseconds; CDN profile follows it.', 300000, 1000, 3600000),
  DATA_GOV_RETRY_DELAY_MS: integer('server', 'Delay before the single retry on a weather HTTP 429.', 1500, 0, 30000),
  CDN_CACHE_MULTIPLIER: field('server', 'Scale live-feed CDN cache/stale windows; 0 disables CDN reuse. Default 1 preserves existing profiles.', '1', (v) => {
    if (!/^\d+(\.\d+)?$/.test(v) || !Number.isFinite(Number(v)) || Number(v) > 12) throw new Error('must be a number from 0 to 12');
    return Number(v);
  }),
  IMAGE_CACHE_SECONDS: integer('server', 'Immutable camera-image HTTP/CDN cache seconds; capped at the 15-minute signed-link lifetime.', 900, 0, 900),
  API_CORS_ORIGIN: field('server', 'Allowed browser origin, or * for the existing public API behavior.', '*', (v) => {
    if (v === '*') return v;
    const parsed = parseUrl(v);
    if (new URL(parsed).origin !== parsed) throw new Error('must be a single origin or *');
    return parsed;
  }),
  VITE_SITE_URL: field('public', 'Public canonical site origin used in build-time social metadata. Rebuild after changing VITE_ values.', 'https://live-traffic-carbon-bc04.vercel.app', (v) => {
    const parsed = parseUrl(v);
    if (new URL(parsed).origin !== parsed) throw new Error('must be an origin without a path');
    return parsed;
  }),
  VITE_TRAFFIC_IMAGES_URL: url('public', 'Public keyless traffic-images fallback used by browser and server.', 'https://api.data.gov.sg/v1/transport/traffic-images'),
  VITE_LIVE_POLL_MS: poll('Expressway speeds, incidents and VMS refresh interval in milliseconds.', 60000),
  VITE_CAMERA_POLL_MS: poll('Camera photo list refresh interval in milliseconds.', 30000),
  VITE_TRAVEL_TIME_POLL_MS: poll('Travel times and camera speed-summary refresh interval in milliseconds.', 120000),
  VITE_RAIN_POLL_MS: poll('Two-hour rain forecast refresh interval in milliseconds.', 300000),
  VITE_FORECAST24H_POLL_MS: poll('24-hour forecast refresh interval in milliseconds.', 900000),
  VITE_AIR_POLL_MS: poll('Air-quality refresh interval in milliseconds.', 600000),
  VITE_WEATHER_ALERTS_POLL_MS: poll('Lightning/heat-stress refresh interval in milliseconds.', 180000),
  VITE_ROAD_CONDITIONS_POLL_MS: poll('Road works and traffic-light refresh interval in milliseconds.', 300000),
  VITE_NEARBY_FEEDS_POLL_MS: poll('Car park and flood-alert refresh interval in milliseconds.', 120000),
  VITE_FEED_RETRY_MS: poll('Retry interval for feeds without a complete initial answer.', 30000),
  VITE_HEALTH_POLL_MS: poll('Shared footer/modal health refresh interval.', 300000),
  VITE_HEALTH_TIMEOUT_MS: integer('public', 'Browser health request timeout; must exceed the server probe timeout.', 15000, 100, 180000),
  VITE_SPEED_STALE_MS: poll('Speed readings older than this are labelled stale.', 900000),
  VITE_CAMERA_STALE_MS: poll('Camera captures older than this are labelled delayed.', 900000),
  VITE_AIR_STALE_MS: poll('Air-quality readings older than this are labelled stale.', 10800000),
  VITE_LIGHTNING_STALE_MS: poll('Lightning observations older than this are labelled stale.', 1800000),
  VITE_SPEED_SNAPSHOT_MAX_AGE_MS: integer('public', 'Maximum age of locally retained fallback speeds.', 86400000, 1000, 604800000),
  VITE_WALL_CYCLE_MS: poll('Wall display checkpoint/tab cycling interval.', 30000),
  VITE_VEHICLE_COUNTING_ENABLED: boolean('public', 'Enable the existing browser-side vehicle counting; disabling avoids loading its model/runtime.', true),
  DEV_HOST: field('development', 'Local dev/preview bind host; default preserves existing LAN access.', '0.0.0.0', (v) => {
    try {
      const ipv6 = (v.match(/:/g)?.length || 0) > 1;
      const parsed = new URL(`http://${ipv6 ? `[${v}]` : v}`);
      if (!/^[a-zA-Z0-9.:-]+$/.test(v) || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error();
    } catch { throw new Error('must be a hostname or IP address without a port'); }
    return v;
  }),
  DEV_PORT: integer('development', 'Local dev port. CLI --port explicitly overrides this setting.', 3100, 1, 65535),
  PREVIEW_PORT: integer('development', 'Local production-preview port.', 4173, 1, 65535),
  DISABLE_HMR: boolean('development', 'Disable HMR and file watching when true.', false),
  OVERPASS_API_URL: url('tools', 'Trusted OpenStreetMap Overpass endpoint for the offline base-map generator.', 'https://overpass-api.de/api/interpreter'),
  OVERPASS_TIMEOUT_MS: integer('tools', 'Base-map generator request timeout.', 180000, 1000, 600000),
  OVERPASS_MAX_ATTEMPTS: integer('tools', 'Base-map generator request attempts.', 4, 1, 8),
  OVERPASS_RETRY_MS: integer('tools', 'Base-map generator linear retry backoff.', 20000, 0, 120000),
  PRODUCTION_HEALTH_URL: field('ci', 'Trusted health URL: Actions sends the bypass secret here. Empty derives from VITE_SITE_URL + /api/health.', '', (v) => v ? parseUrl(v) : ''),
  HEALTHCHECK_RETRY_DELAY_MS: integer('ci', 'GitHub health-check delay before the second attempt.', 90000, 0, 120000),
  HEALTHCHECK_TIMEOUT_MS: integer('ci', 'GitHub health-check HTTP timeout.', 60000, 1000, 120000),
} as const;
export type EnvKey = keyof typeof ENV_SCHEMA;
type Values = { [K in EnvKey]: ReturnType<typeof ENV_SCHEMA[K]['parse']> };
export const ENV_KEYS = Object.keys(ENV_SCHEMA) as EnvKey[];

// Vercel injects these public platform values for Vite. They are not app settings.
// Keep this explicit so a secret hidden under an arbitrary VITE_VERCEL_* name is rejected.
const PLATFORM_PUBLIC_KEYS = new Set([
  'VITE_VERCEL_ENV', 'VITE_VERCEL_TARGET_ENV', 'VITE_VERCEL_URL', 'VITE_VERCEL_BRANCH_URL',
  'VITE_VERCEL_PROJECT_PRODUCTION_URL', 'VITE_VERCEL_REGION', 'VITE_VERCEL_PROJECT_ID',
  'VITE_VERCEL_DEPLOYMENT_ID', 'VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG',
  ...['PROVIDER', 'REPO_SLUG', 'REPO_OWNER', 'REPO_ID', 'COMMIT_REF', 'COMMIT_SHA',
    'COMMIT_MESSAGE', 'COMMIT_AUTHOR_LOGIN', 'COMMIT_AUTHOR_NAME', 'PREVIOUS_SHA', 'PULL_REQUEST_ID']
    .map((name) => `VITE_VERCEL_GIT_${name}`),
]);

function read(env: Environment, scopes: Scope[]): Values {
  const result: Partial<Values> = {};
  const errors: string[] = [];
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && !Object.hasOwn(ENV_SCHEMA, key) && !PLATFORM_PUBLIC_KEYS.has(key)) errors.push(`${key}: unknown public setting; secrets must never use VITE_`);
  }
  for (const key of ENV_KEYS) {
    const spec = ENV_SCHEMA[key];
    if (!scopes.includes(spec.scope)) continue;
    const input = env[key];
    try {
      if (input != null && typeof input !== 'string') throw new Error('must be a string');
      const value = typeof input === 'string' ? input.trim() : '';
      Object.assign(result, { [key]: spec.parse(value || spec.default) });
    } catch (error) {
      errors.push(`${key}: ${error instanceof Error ? error.message : 'invalid setting'}`);
    }
  }
  if (errors.length) throw new Error(`Invalid configuration:\n${errors.join('\n')}`);
  return result as Values;
}
function freeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
function publicConfig(v: Values) {
  return {
    siteUrl: v.VITE_SITE_URL,
    trafficImagesUrl: v.VITE_TRAFFIC_IMAGES_URL,
    poll: { live: v.VITE_LIVE_POLL_MS, cameras: v.VITE_CAMERA_POLL_MS, travelTimes: v.VITE_TRAVEL_TIME_POLL_MS,
      rain: v.VITE_RAIN_POLL_MS, forecast24h: v.VITE_FORECAST24H_POLL_MS, air: v.VITE_AIR_POLL_MS,
      weatherAlerts: v.VITE_WEATHER_ALERTS_POLL_MS, roadConditions: v.VITE_ROAD_CONDITIONS_POLL_MS,
      nearbyFeeds: v.VITE_NEARBY_FEEDS_POLL_MS, retry: v.VITE_FEED_RETRY_MS, health: v.VITE_HEALTH_POLL_MS },
    freshness: { speeds: v.VITE_SPEED_STALE_MS, cameras: v.VITE_CAMERA_STALE_MS, air: v.VITE_AIR_STALE_MS,
      lightning: v.VITE_LIGHTNING_STALE_MS, speedSnapshot: v.VITE_SPEED_SNAPSHOT_MAX_AGE_MS },
    healthTimeoutMs: v.VITE_HEALTH_TIMEOUT_MS,
    wallCycleMs: v.VITE_WALL_CYCLE_MS,
    vehicleCountingEnabled: v.VITE_VEHICLE_COUNTING_ENABLED,
  };
}
/** Browser-safe projection: server settings are neither parsed nor returned here. */
export function createPublicConfig(env: Environment = {}) { return freeze(publicConfig(read(env, ['public']))); }

/** The single complete application config, evaluated once per server/build process. */
export function createConfig(env: Environment = {}) {
  const v = read(env, ['public', 'server', 'development', 'tools', 'ci']);
  if (v.SPEED_MAX_PAGES < v.SPEED_PAGE_CONCURRENCY) throw new Error('Invalid configuration: SPEED_MAX_PAGES must be at least SPEED_PAGE_CONCURRENCY');
  if (v.VITE_HEALTH_TIMEOUT_MS <= v.HEALTH_PROBE_TIMEOUT_MS) throw new Error('Invalid configuration: VITE_HEALTH_TIMEOUT_MS must exceed HEALTH_PROBE_TIMEOUT_MS');
  if (v.HEALTHCHECK_RETRY_DELAY_MS + 2 * v.HEALTHCHECK_TIMEOUT_MS > 240000)
    throw new Error('Invalid configuration: HEALTHCHECK_RETRY_DELAY_MS and HEALTHCHECK_TIMEOUT_MS must leave setup time in the five-minute workflow');
  const environment = typeof env.NODE_ENV === 'string' && env.NODE_ENV ? env.NODE_ENV : 'production';
  if (!['development', 'production', 'test'].includes(environment)) throw new Error('Invalid configuration: NODE_ENV must be development, production or test');
  const lta = (path: string) => `${v.LTA_BASE_URL}/${path}`;
  const gov = (path: string) => `${v.DATA_GOV_BASE_URL}/${path}`;
  const cache = (seconds: number, stale: number) => [Math.round(seconds * v.CDN_CACHE_MULTIPLIER), Math.round(stale * v.CDN_CACHE_MULTIPLIER)] as const;
  return freeze({ ...publicConfig(v),
    server: {
      environment,
      accountKey: v.LTA_ACCOUNT_KEY || v.LTA_API_KEY,
      corsOrigin: v.API_CORS_ORIGIN,
      requestTimeoutMs: v.REQUEST_TIMEOUT_MS, weatherTimeoutMs: v.DATA_GOV_TIMEOUT_MS, probeTimeoutMs: v.HEALTH_PROBE_TIMEOUT_MS,
      upstreams: { ltaBase: v.LTA_BASE_URL, incidents: lta('TrafficIncidents'), images: lta('Traffic-Imagesv2'), speedBands: lta('v4/TrafficSpeedBands'),
        vms: lta('VMS'), travelTimes: lta('EstTravelTimes'), roadWorks: lta('RoadWorks'), faultyLights: lta('FaultyTrafficLights'), carParks: lta('CarParkAvailabilityv2'),
        rain: gov('two-hr-forecast'), forecast24h: gov('twenty-four-hr-forecast'), psi: gov('psi'), pm25: gov('pm25'),
        lightning: gov('weather?api=lightning'), wbgt: gov('weather?api=wbgt'), floods: gov('weather/flood-alerts') },
      lta: { concurrency: v.LTA_PAGE_CONCURRENCY, maxPages: v.LTA_MAX_PAGES, attempts: v.LTA_MAX_ATTEMPTS, retryDelayMs: v.LTA_RETRY_DELAY_MS },
      speeds: { concurrency: v.SPEED_PAGE_CONCURRENCY, maxPages: v.SPEED_MAX_PAGES, attempts: v.SPEED_MAX_ATTEMPTS, cacheTtlMs: v.SPEED_CACHE_TTL_MS },
      weatherRetryDelayMs: v.DATA_GOV_RETRY_DELAY_MS,
      imageCacheSeconds: v.IMAGE_CACHE_SECONDS,
      cache: { proxy: cache(30, 60), health: cache(30, 30), weather: cache(300, 600), forecast24h: cache(900, 1800),
        weatherAlerts: cache(120, 300), roadConditions: cache(300, 900), carParks: cache(60, 120),
        speeds: cache(v.SPEED_CACHE_TTL_MS / 1000, v.SPEED_CACHE_TTL_MS / 500) },
    },
    dev: { host: v.DEV_HOST, port: v.DEV_PORT, previewPort: v.PREVIEW_PORT, disableHmr: v.DISABLE_HMR },
    tools: { overpass: { url: v.OVERPASS_API_URL, timeoutMs: v.OVERPASS_TIMEOUT_MS, attempts: v.OVERPASS_MAX_ATTEMPTS, retryMs: v.OVERPASS_RETRY_MS } },
    automation: { healthUrl: v.PRODUCTION_HEALTH_URL || `${v.VITE_SITE_URL}/api/health`, retryDelayMs: v.HEALTHCHECK_RETRY_DELAY_MS, timeoutMs: v.HEALTHCHECK_TIMEOUT_MS },
  });
}

/** Generated from the schema so .env.example cannot silently omit a supported setting. */
export function environmentExample(): string {
  const lines = ['# Generated by bun run config:example. Copy selected overrides into .env.local; never overwrite an existing secret file.',
    '# VITE_* values are PUBLIC build-time settings. All defaults preserve current behavior.',
    '# Missing/blank LTA keys intentionally keep keyless cameras/weather usable. Set a real LTA_ACCOUNT_KEY for all LTA feeds.', ''];
  let previous: Scope | undefined;
  for (const key of ENV_KEYS) {
    const spec = ENV_SCHEMA[key];
    if (spec.scope !== previous) { lines.push('', `# --- ${spec.scope} settings ---`); previous = spec.scope; }
    lines.push(`# ${spec.description}`, `${key}=${spec.default}`);
  }
  lines.push('', '# Platform-owned: NODE_ENV is set by Vite/Node; do not copy it into local overrides.',
    '# Vercel also injects public VITE_VERCEL_* deployment/Git/observability metadata; no local assignments are needed.',
    '# CI ONLY: add VERCEL_AUTOMATION_BYPASS_SECRET as a GitHub Actions secret. It is never app/browser config.',
    '# Health variables above are GitHub Actions repository variables when used by the scheduled workflow.', '');
  return lines.join('\n');
}
