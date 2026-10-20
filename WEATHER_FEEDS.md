# Weather feed reliability

## Request control

Rain, the 24-hour outlook, PSI/PM2.5, lightning/heat and flood requests use one data.gov.sg client per server function instance. It shares matching pending requests and spaces request starts by 2,100 ms. Health checks use the same gate for their seven keyless weather probes and do not retry or accept cached successes.

[data.gov.sg documents](https://guide.data.gov.sg/developer-guide/api-overview/api-rate-limits) a keyless real-time limit of six requests per ten seconds. The former seven-probe health burst could contribute to 429 responses. Other traffic and provider-side enforcement can also cause rate limits; the observed 429 does not prove a single cause.

A 429 sets a shared instance cooldown. One inline retry respects `Retry-After` seconds or an HTTP date. Without that header the wait is ten seconds plus up to 10% jitter. If the provider requests more than twelve seconds, the request fails promptly and later calls respect the cooldown. Non-429 failures are not retried. Diagnostics keep fixed messages/statuses and parsed numeric retry metadata, never raw provider headers, bodies or URLs.

**Scope:** module state is local to a warm function instance. Different Vercel functions, regions, cold starts and visitors do not share a distributed quota. These changes reduce avoidable bursts; they cannot guarantee the provider never returns 429. A shared external limiter or a data.gov.sg API key would be a separate infrastructure change.

## Two-hour forecast delivery

The rain service validates coordinates, area text, issue time and validity. Concurrent refreshes share work. Valid data is fresh in the instance cache for five minutes. The API preserves its source issue/update/validity fields and adds `delivery.state` (`current` or `retained`) and `delivery.fetchedAt` (last successful upstream receipt). `current` means the latest successful retrieval, not a live rain observation.

After a refresh fails, the last good forecast may be retained for up to thirty minutes after receipt, only during its original published validity period. A retained response has HTTP 200, explicit retained metadata and `Cache-Control: no-store`. A rate-limit deadline is exposed as numeric `delivery.retryAt` and a generated `Retry-After`. Without usable data the API returns safe 502 JSON and no-store.

Fresh CDN lifetime is capped by the remaining instance freshness and source validity. Rain has no stale-while-revalidate window, preventing the edge from extending that validity. Browser cache remains revalidated. See [Vercel cache header precedence](https://vercel.com/docs/caching/cache-control-headers).

All mounted browser rain consumers share one pending request, timer and refresh listener. They poll every five minutes after success and retry after thirty seconds on failure, respecting longer provider cooldowns even on manual refresh. Offline/failed refreshes retain original data age. Camera and radar views display a retained/unavailable notice; expired forecasts are removed from current readings. Pickup text labels retained forecasts explicitly. Health remains a measured upstream check, independently of retained display data.

## Configuration and checks

Settings are validated in `config/schema.ts` and generated into `.env.example`:

- `DATA_GOV_MIN_INTERVAL_MS=2100`
- `DATA_GOV_RETRY_DELAY_MS=10000`
- `DATA_GOV_MAX_RETRY_WAIT_MS=12000`
- `RAIN_CACHE_TTL_MS=300000`
- `RAIN_MAX_RETAINED_MS=1800000`
- `VITE_HEALTH_TIMEOUT_MS=30000` (allows the paced seven-probe batch plus an eight-second probe)

Zero pacing is supported for isolated synthetic tests. Keep normal pacing enabled for provider requests. No credentials or remote environment changes are required for these defaults.

`tests/weather-reliability.test.ts` exercises pacing, coalescing, bounded retries, long cooldowns, invalid payloads, cache age and expiry boundaries, Node/Web response behavior, health failure visibility, shared browser cleanup and recovery using synthetic fixtures. Run `bun run lint`, `bun run test` and `bun run build` before publication.
