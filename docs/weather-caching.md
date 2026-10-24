# Weather result caching after pagination

Preview branch `codex/weather-result-caching`, from main `b1abb58`, 24 October 2026. This extends the caches already released in PR #25 and preserves PR #26's pagination contracts. Main merge requires explicit approval; PR #23 remains separate.

## Remaining repeated cost

The largest existing work already has caches: full LTA speed aggregation, paginated roadworks/car parks/faults, on-device vehicle analysis, rain forecasts, shared frontend feeds and model initialization. The remaining selected gap is normalized weather results on origin requests. Paginated responses intentionally bypass the CDN and service-worker offline cache, so repeating pages could repeat paced weather reads and normalization even while the underlying issue had not changed. The data.gov client coalesces active reads but does not retain completed application results; health must remain a live diagnostic.

| Result | Work per uncached build | New default TTL |
| --- | --- | --- |
| Air quality | PSI + PM2.5 reads, region matching and normalization | 5 minutes |
| 24-hour outlook | Provider read plus general/period normalization | 15 minutes, capped by published validity end |
| Lightning + heat stress | Two reads plus strike/station normalization | 1 minute |

These priorities come from code inspection and deterministic synthetic call counts, not production billing or latency profiling. Native LTA windows, flood lookback, geography memoization and already-cached operations were not given duplicate caches or an unrelated API redesign.

## Implementation

- `server/cache/feedResult.ts` retains one complete keyless normalized result per owning warm handler, with a 512 KiB serialized JSON budget. Larger successful answers still return but are not retained. Three handlers therefore have at most three retained results; this is not a precise heap/in-flight-response memory bound.
- Air quality, the 24-hour forecast and weather-alert loaders now produce transport-free result envelopes, then use the existing Node/Web list sender. Pagination queries do not create separate cache keys. Full reads and all collection/page projections reuse the same normalized body after normal method/body/query/CORS validation.
- `shared/ttlCache.ts` now also accepts a result-dependent lifetime, so incomplete/error results get zero retention and forecast reuse cannot extend beyond the published validity end. Existing numeric-TTL consumers retain their behavior. Only successful eligible results are reusable: source arrays/timestamps must satisfy the handler's completeness checks and upstream validation/normalization must have completed. This is not a new full schema for every possible provider field.
- Body identity, source observation/issued times and ordering remain unchanged on hits. There is no fresh receipt timestamp assigned to an old cached body. CDN fresh + stale windows shrink to the remaining origin lifetime; they do not restart a full additional TTL. Paged answers remain `no-store` and worker network-only.
- Partial sources, incomplete observations and provider errors are not retained as completed successes. Their responses are browser/CDN `no-store`, with safe error handling and numeric retry hints. Independent requests try again through the existing pacing/retry/circuit rules. Concurrent callers can share one underlying partial attempt and its diagnostics; no raw error data is retained or logged.
- Expired completed successes are removed before refresh. This helper does not introduce stale-on-error fallback; the existing separate rain retention policy is unchanged. A valid cached success may answer until TTL during an upstream outage. Health probes call the existing uncached provider path and still report a failing dependency.
- Missing/expired forecast validity prevents completed reuse. The endpoint's pre-existing response/observation semantics remain; this change does not invent a new issue, silently extend an expired forecast or claim a historic snapshot registry.

## TTL and invalidation

Validated server-only settings in `config/schema.ts`, regenerated into `.env.example`:

| Setting | Default | Range |
| --- | --- | --- |
| `AIR_CACHE_TTL_MS` | 300000 | 0–3600000 |
| `FORECAST24H_CACHE_TTL_MS` | 900000 | 0–3600000 |
| `WEATHER_ALERTS_CACHE_TTL_MS` | 60000 | 0–180000 |

Zero disables completed retention while still coalescing active builds. Changes apply with process restart/deployment. Defaults work without new credentials or environment provisioning.

Automatic invalidation is TTL expiry (inclusive boundary), forecast validity end, process termination/deployment or payload oversize exclusion. Changed provider data is fetched at the next allowed refresh; a TTL cache cannot discover new data before it reads the provider.

Explicit internal invalidation is available from each owning API module:

```ts
import { invalidateResultCache as invalidateAir } from '../api/airquality';
import { invalidateResultCache as invalidateForecast } from '../api/forecast24h';
import { invalidateResultCache as invalidateWeatherAlerts } from '../api/_weatheralerts';
invalidateAir();
invalidateForecast();
invalidateWeatherAlerts();
```

There is no public bypass/invalidation route or query flag. Clearing detaches pending writers so an old completion cannot refill a replacement cache. Already accepted requests may finish for their original callers. An invalidation affects its current warm instance only; it cannot purge another region/instance, existing CDN copies or offline browser copies. Origin results are not persisted and no hosted shared cache, dependency or service was provisioned. Existing CDN copies expire within their emitted deadlines, and full-feed offline copies retain the existing explicit offline provenance.

## Verification

- All 275 full-suite Node tests passed, zero failures/skips, including the wrapper's four offline Python cases. Added 11 focused groups for the generic result cache and real handler integration in synthetic Node/Web transports. Type checking, transport audit, production build, generated-environment consistency and whitespace checks passed.
- In each synthetic transport, twenty sequential paged air-quality reads call PSI and PM2.5 once each (two calls rather than the code-derived uncached baseline of forty). Lightning/heat stress likewise use two calls; the forecast uses one rather than twenty. Separate concurrent tests verify build coalescing and later page offsets reuse the body/revision. Existing upstream in-flight coalescing already helped concurrent network reads; these tests distinguish that from the new completed-result reuse.
- Checked original timestamps, exact TTL boundaries, remaining CDN lifetime, forecast validity, explicit invalidation/old-writer ownership, partial/error/incomplete/oversized/disabled behavior, recovery and health bypass. No source outage is injected into a real provider.
- Synthetic tests do not establish production spend, real-world latency, cross-instance reuse or browser performance. No real camera metadata/photo, user storage, permissions or notification was requested. The earlier interactive-browser approval usage-limit limitation remains; no alternate browser/protocol workaround or visual pass is used.

Official cache-layer guidance consulted: [Vercel Cache-Control headers](https://vercel.com/docs/caching/cache-control-headers). This implementation uses warm-instance memory and the existing CDN headers, not Vercel Runtime Cache.

## Preview publication

Implementation `0cbb0ba3d7518ca3e10be7d3660d5e3d87700aab` is published in attached draft [PR #27](https://github.com/Mikazukiangus/live-traffic/pull/27). GitHub Checks runs `40060770109` and `40060794975` and Vercel deployment/feedback checks passed at that exact head. Required CI job diagnostics confirm 275 passing tests, zero failures/skips, type checks, transport audit and build.

[Preview](https://live-traffic-6b3r1f5dz-carbon-bc04.vercel.app) is deployment `dpl_Acxq9dRtun2SjgUHFZcQWo7eKuXx`, READY for the intended project/team, preview branch and implementation SHA. Selected authenticated checks returned HTTP 200 for the homepage, `/api/forecast24h?limit=1` (one of three periods) and `/api/airquality?limit=2` (two of five regions).

These verify selected deployed success paths. They do not measure cache hit rate, provider savings, cross-instance reuse, real browser execution or every feed's current health; synthetic tests establish cache policies and call counts. No real camera metadata/photo, user storage/permissions, notification or provider outage was probed. This follow-up updates documentation/handoff only; main/production remain unchanged, PR #27 awaits explicit merge approval, and PR #23 remains independently pending.
