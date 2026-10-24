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
function siteOrigin(value: string): string {
  // URL parsing alone permits quote-bearing hosts and normalizes some control characters.
  if (/["'<>`\\\x00-\x20\x7f]/.test(value)) throw new Error('must be a valid canonical origin');
  const parsed = parseUrl(value);
  const location = new URL(parsed);
  const host = location.hostname;
  const dns = host.replace(/\.$/, '');
  const validHost = /^\[[0-9a-f:.]+\]$/i.test(host) ||
    (dns.length <= 253 && dns.split('.').every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)));
  if (!validHost || location.origin !== parsed) throw new Error('must be an origin with a valid hostname and no path');
  return parsed;
}
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
  LTA_RETRY_DELAY_MS: integer('server', 'Base for exponential LTA read retry backoff, with jitter.', 400, 0, 30000),
  PROVIDER_RETRY_MAX_WAIT_MS: integer('server', 'Maximum inline provider retry delay; longer Retry-After fails promptly without an early retry.', 12000, 0, 60000),
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD: integer('server', 'Final failed reads before pausing an independent provider feed in one warm instance.', 5, 2, 50),
  PROVIDER_CIRCUIT_WINDOW_MS: integer('server', 'Recent failure window for each provider circuit in milliseconds.', 60000, 1000, 600000),
  PROVIDER_CIRCUIT_COOLDOWN_MS: integer('server', 'Provider pause before permitting one recovery attempt in milliseconds.', 30000, 1000, 300000),
  LTA_MAX_ATTEMPTS: integer('server', 'Attempts per ordinary paginated LTA request.', 3, 1, 5),
  LTA_PAGE_CONCURRENCY: integer('server', 'Ordinary dataset concurrency; capped at 10 to avoid LTA overload.', 6, 1, 10),
  LTA_MAX_PAGES: integer('server', 'Safety cap for ordinary LTA datasets.', 40, 1, 2000),
  SPEED_PAGE_CONCURRENCY: integer('server', 'Speed-band concurrency; capped at 10 after observed upstream throttling.', 10, 1, 10),
  SPEED_MAX_ATTEMPTS: integer('server', 'Attempts per speed-band page.', 4, 1, 5),
  SPEED_MAX_PAGES: integer('server', 'Safety cap for the complete speed-band dataset.', 600, 1, 2000),
  SPEED_CACHE_TTL_MS: integer('server', 'In-process speed cache lifetime in milliseconds; CDN profile follows it.', 300000, 1000, 3600000),
  ROADWORKS_CACHE_TTL_MS: integer('server', 'Warm-instance complete roadworks dataset cache; filtering by Singapore date still runs on every answer.', 300000, 0, 3600000),
  FAULTY_LIGHTS_CACHE_TTL_MS: integer('server', 'Warm-instance complete traffic-light faults cache lifetime.', 60000, 0, 300000),
  CARPARKS_CACHE_TTL_MS: integer('server', 'Warm-instance complete car park availability cache lifetime.', 60000, 0, 300000),
  DATA_GOV_RETRY_DELAY_MS: integer('server', 'Fallback delay for a single weather HTTP 429 retry when Retry-After is absent.', 10000, 0, 60000),
  DATA_GOV_MIN_INTERVAL_MS: integer('server', 'Minimum spacing of keyless weather requests within one server instance. Zero disables pacing for isolated tests.', 2100, 0, 30000),
  DATA_GOV_MAX_RETRY_WAIT_MS: integer('server', 'Maximum inline Retry-After wait; longer cooldowns fail promptly and retain valid forecasts.', 12000, 0, 60000),
  DATA_GOV_REQUEST_BUDGET_MS: integer('server', 'Total weather read/retry budget after initial pacing, including body reads and backoff.', 25000, 100, 120000),
  RAIN_CACHE_TTL_MS: integer('server', 'In-instance two-hour forecast cache lifetime; never extends the provider validity period.', 300000, 0, 3600000),
  RAIN_MAX_RETAINED_MS: integer('server', 'Maximum age since receiving a rain forecast that may be retained after a refresh failure; validity still applies.', 1800000, 1000, 7200000),
  CDN_CACHE_MULTIPLIER: field('server', 'Scale live-feed CDN cache/stale windows; 0 disables CDN reuse. Default 1 preserves existing profiles.', '1', (v) => {
    if (!/^\d+(\.\d+)?$/.test(v) || !Number.isFinite(Number(v)) || Number(v) > 12) throw new Error('must be a number from 0 to 12');
    return Number(v);
  }),
  IMAGE_CACHE_SECONDS: integer('server', 'Immutable camera-image HTTP/CDN cache seconds; capped at the 15-minute signed-link lifetime.', 900, 0, 900),
  API_CORS_ORIGINS: field('server', 'Comma-separated extra trusted frontend origins. Canonical site and exact Vercel deployment origins are included automatically. No wildcards.', '', (v) => {
    if (!v) return [];
    const origins = v.split(',');
    if (origins.length > 32 || origins.some((origin) => !origin.trim())) throw new Error('must contain 1 to 32 exact origins');
    return [...new Set(origins.map((origin) => siteOrigin(origin.trim())))];
  }),
  API_CORS_ORIGIN: field('server', 'Legacy single extra frontend origin; prefer API_CORS_ORIGINS. Empty adds nothing. Wildcard is rejected.', '', (v) => v ? siteOrigin(v) : ''),
  VITE_SITE_URL: field('public', 'Public canonical site origin used in build-time social metadata. Rebuild after changing VITE_ values.', 'https://live-traffic-carbon-bc04.vercel.app', (v) => {
    return siteOrigin(v);
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
  VITE_HEALTH_TIMEOUT_MS: integer('public', 'Browser health request timeout; includes paced weather probes.', 30000, 100, 180000),
  VITE_REQUEST_TIMEOUT_MS: integer('public', 'Browser API/camera request deadline, including response body reads.', 30000, 100, 180000),
  VITE_SPEED_REQUEST_TIMEOUT_MS: integer('public', 'Browser speed request deadline; allows cold paginated aggregation.', 90000, 100, 300000),
  VITE_ASSET_TIMEOUT_MS: integer('public', 'Asset/model download and vehicle-runtime initialization deadline.', 60000, 100, 300000),
  VITE_SPEED_STALE_MS: poll('Speed readings older than this are labelled stale.', 900000),
  VITE_CAMERA_STALE_MS: poll('Camera captures older than this are labelled delayed.', 900000),
  VITE_AIR_STALE_MS: poll('Air-quality readings older than this are labelled stale.', 10800000),
  VITE_LIGHTNING_STALE_MS: poll('Lightning observations older than this are labelled stale.', 1800000),
  VITE_SPEED_SNAPSHOT_MAX_AGE_MS: integer('public', 'Maximum age of locally retained fallback speeds.', 86400000, 1000, 604800000),
  VITE_WALL_CYCLE_MS: poll('Wall display checkpoint/tab cycling interval.', 30000),
  VITE_VEHICLE_COUNTING_ENABLED: boolean('public', 'Enable the existing browser-side vehicle counting; disabling avoids loading its model/runtime.', true),
  VITE_VEHICLE_CACHE_TTL_MS: integer('public', 'Page-memory exact-photo vehicle count lifetime; zero disables completed-result caching.', 300000, 0, 900000),
  VITE_VEHICLE_CACHE_MAX_ENTRIES: integer('public', 'Maximum exact-photo counts retained in page memory; no images or results are persisted.', 32, 1, 128),
  VITE_BACKGROUND_MAX_PENDING: integer('public', 'Maximum waiting device-local background jobs; running jobs have one slot per lane.', 32, 4, 256),
  VITE_BACKGROUND_IDLE_TIMEOUT_MS: integer('public', 'Maximum wait for an idle browser turn before optional work starts.', 1000, 1, 10000),
  VITE_BACKGROUND_JOB_MAX_AGE_MS: integer('public', 'Device-local background job lifetime including queue wait and retry backoff.', 120000, 1000, 600000),
  DEV_HOST: field('development', 'Local dev/preview bind host; default preserves existing LAN access.', '0.0.0.0', (v) => {
    try {
      const ipv6 = (v.match(/:/g)?.length || 0) > 1;
      const parsed = new URL(`https://${ipv6 ? `[${v}]` : v}`);
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
  OVERPASS_RETRY_MS: integer('tools', 'Base-map read-only query exponential retry base, with jitter.', 20000, 0, 120000),
  OVERPASS_MAX_RETRY_WAIT_MS: integer('tools', 'Maximum inline Overpass retry wait; longer Retry-After fails promptly.', 120000, 0, 600000),
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

// These settings cause network requests or public resource URLs. Local HTTP is test/dev-only.
const HTTPS_SETTINGS = new Set<EnvKey>([
  'LTA_BASE_URL', 'DATA_GOV_BASE_URL', 'VITE_SITE_URL', 'VITE_TRAFFIC_IMAGES_URL',
  'OVERPASS_API_URL', 'PRODUCTION_HEALTH_URL',
]);

function read(env: Environment, scopes: Scope[], httpsOnly = false): Values {
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
      const parsed = spec.parse(value || spec.default);
      if ((httpsOnly || key === 'PRODUCTION_HEALTH_URL') && HTTPS_SETTINGS.has(key) &&
          typeof parsed === 'string' && parsed && new URL(parsed).protocol !== 'https:')
        throw new Error('must use HTTPS in builds/deployments and production health checks');
      Object.assign(result, { [key]: parsed });
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
    timeouts: { request: v.VITE_REQUEST_TIMEOUT_MS, speeds: v.VITE_SPEED_REQUEST_TIMEOUT_MS, assets: v.VITE_ASSET_TIMEOUT_MS },
    wallCycleMs: v.VITE_WALL_CYCLE_MS,
    vehicleCountingEnabled: v.VITE_VEHICLE_COUNTING_ENABLED,
    vehicleCache: { ttlMs: v.VITE_VEHICLE_CACHE_TTL_MS, maxEntries: v.VITE_VEHICLE_CACHE_MAX_ENTRIES },
    background: { maxPending: v.VITE_BACKGROUND_MAX_PENDING, idleTimeoutMs: v.VITE_BACKGROUND_IDLE_TIMEOUT_MS,
      maxAgeMs: v.VITE_BACKGROUND_JOB_MAX_AGE_MS },
  };
}
/** Browser-safe projection: server settings are neither parsed nor returned here. */
export function createPublicConfig(env: Environment = {}) {
  const deployed = env.PROD === true || env.NODE_ENV === 'production' ||
    env.VITE_VERCEL_ENV === 'production' || env.VITE_VERCEL_ENV === 'preview';
  return freeze(publicConfig(read(env, ['public'], deployed)));
}

/** The single complete application config, evaluated once per server/build process. */
export function createConfig(env: Environment = {}) {
  const environment = typeof env.NODE_ENV === 'string' && env.NODE_ENV ? env.NODE_ENV : 'production';
  if (!['development', 'production', 'test'].includes(environment)) throw new Error('Invalid configuration: NODE_ENV must be development, production or test');
  const httpsOnly = environment === 'production' || env.VERCEL === '1' ||
    env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
  const v = read(env, ['public', 'server', 'development', 'tools', 'ci'], httpsOnly);
  const corsOrigins = new Set([v.VITE_SITE_URL, ...v.API_CORS_ORIGINS, ...(v.API_CORS_ORIGIN ? [v.API_CORS_ORIGIN] : [])]);
  if (httpsOnly && [...corsOrigins].some((origin) => new URL(origin).protocol !== 'https:'))
    throw new Error('Invalid configuration: API_CORS_ORIGINS/API_CORS_ORIGIN must use HTTPS in builds/deployments');
  // Trust platform-owned deployment metadata only, never a request Host/Forwarded header.
  if (env.VERCEL === '1') {
    for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
      if (env[key] === undefined || env[key] === '') continue;
      try {
        if (typeof env[key] !== 'string') throw new Error();
        const host = env[key] as string;
        const origin = siteOrigin(`https://${host}`);
        if (new URL(origin).host !== host) throw new Error();
        corsOrigins.add(origin);
      } catch { throw new Error(`Invalid configuration: ${key} must be a deployment hostname without a scheme or path`); }
    }
  }
  if (!httpsOnly) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) for (const port of [v.DEV_PORT, v.PREVIEW_PORT]) {
      const origin = new URL(`https://${host}`);
      origin.protocol = 'http:';
      origin.port = String(port);
      corsOrigins.add(origin.origin);
    }
  }
  if (v.SPEED_MAX_PAGES < v.SPEED_PAGE_CONCURRENCY) throw new Error('Invalid configuration: SPEED_MAX_PAGES must be at least SPEED_PAGE_CONCURRENCY');
  if (v.VITE_HEALTH_TIMEOUT_MS <= v.HEALTH_PROBE_TIMEOUT_MS + 6 * v.DATA_GOV_MIN_INTERVAL_MS) throw new Error('Invalid configuration: VITE_HEALTH_TIMEOUT_MS must exceed HEALTH_PROBE_TIMEOUT_MS plus six paced weather intervals');
  if (v.HEALTHCHECK_RETRY_DELAY_MS + 2 * v.HEALTHCHECK_TIMEOUT_MS > 240000)
    throw new Error('Invalid configuration: HEALTHCHECK_RETRY_DELAY_MS and HEALTHCHECK_TIMEOUT_MS must leave setup time in the five-minute workflow');
  const lta = (path: string) => `${v.LTA_BASE_URL}/${path}`;
  const gov = (path: string) => `${v.DATA_GOV_BASE_URL}/${path}`;
  const cache = (seconds: number, stale: number) => [Math.round(seconds * v.CDN_CACHE_MULTIPLIER), Math.round(stale * v.CDN_CACHE_MULTIPLIER)] as const;
  return freeze({ ...publicConfig(v),
    server: {
      environment,
      allowLoopbackHttp: !httpsOnly,
      accountKey: v.LTA_ACCOUNT_KEY || v.LTA_API_KEY,
      corsOrigins: [...corsOrigins],
      requestTimeoutMs: v.REQUEST_TIMEOUT_MS, weatherTimeoutMs: v.DATA_GOV_TIMEOUT_MS, probeTimeoutMs: v.HEALTH_PROBE_TIMEOUT_MS,
      circuit: { failureThreshold: v.PROVIDER_CIRCUIT_FAILURE_THRESHOLD, windowMs: v.PROVIDER_CIRCUIT_WINDOW_MS, cooldownMs: v.PROVIDER_CIRCUIT_COOLDOWN_MS },
      retryMaxWaitMs: v.PROVIDER_RETRY_MAX_WAIT_MS,
      upstreams: { ltaBase: v.LTA_BASE_URL, incidents: lta('TrafficIncidents'), images: lta('Traffic-Imagesv2'), speedBands: lta('v4/TrafficSpeedBands'),
        vms: lta('VMS'), travelTimes: lta('EstTravelTimes'), roadWorks: lta('RoadWorks'), faultyLights: lta('FaultyTrafficLights'), carParks: lta('CarParkAvailabilityv2'),
        rain: gov('two-hr-forecast'), forecast24h: gov('twenty-four-hr-forecast'), psi: gov('psi'), pm25: gov('pm25'),
        lightning: gov('weather?api=lightning'), wbgt: gov('weather?api=wbgt'), floods: gov('weather/flood-alerts') },
      lta: { concurrency: v.LTA_PAGE_CONCURRENCY, maxPages: v.LTA_MAX_PAGES, attempts: v.LTA_MAX_ATTEMPTS, retryDelayMs: v.LTA_RETRY_DELAY_MS },
      speeds: { concurrency: v.SPEED_PAGE_CONCURRENCY, maxPages: v.SPEED_MAX_PAGES, attempts: v.SPEED_MAX_ATTEMPTS, cacheTtlMs: v.SPEED_CACHE_TTL_MS },
      snapshotCache: { roadWorksMs: v.ROADWORKS_CACHE_TTL_MS, faultyLightsMs: v.FAULTY_LIGHTS_CACHE_TTL_MS, carParksMs: v.CARPARKS_CACHE_TTL_MS },
      weatherRetryDelayMs: v.DATA_GOV_RETRY_DELAY_MS,
      weather: { minIntervalMs: v.DATA_GOV_MIN_INTERVAL_MS, maxRetryWaitMs: v.DATA_GOV_MAX_RETRY_WAIT_MS, requestBudgetMs: v.DATA_GOV_REQUEST_BUDGET_MS,
        rainCacheTtlMs: v.RAIN_CACHE_TTL_MS, rainMaxRetainedMs: v.RAIN_MAX_RETAINED_MS },
      imageCacheSeconds: v.IMAGE_CACHE_SECONDS,
      cache: { proxy: cache(30, 60), health: cache(30, 30), weather: cache(300, 600), forecast24h: cache(900, 1800),
        weatherAlerts: cache(120, 300), roadConditions: cache(300, 900), carParks: cache(60, 120),
        speeds: cache(v.SPEED_CACHE_TTL_MS / 1000, v.SPEED_CACHE_TTL_MS / 500) },
    },
    dev: { host: v.DEV_HOST, port: v.DEV_PORT, previewPort: v.PREVIEW_PORT, disableHmr: v.DISABLE_HMR },
    tools: { overpass: { url: v.OVERPASS_API_URL, timeoutMs: v.OVERPASS_TIMEOUT_MS, attempts: v.OVERPASS_MAX_ATTEMPTS, retryMs: v.OVERPASS_RETRY_MS, maxRetryWaitMs: v.OVERPASS_MAX_RETRY_WAIT_MS } },
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
