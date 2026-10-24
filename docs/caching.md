# Repeated-operation caching

Preview work from main `db6958e` on `codex/bounded-result-caching` (24 October 2026). Main merge requires explicit approval. Separate draft PR #23 remains unmerged.

## Where the cost is

These rankings come from the code and synthetic call-count tests, not production billing or latency measurements. There is no database/query engine in this app.

| Operation | Repeated work | Cache policy |
| --- | --- | --- |
| Full expressway speed summary | Potentially hundreds of 500-row LTA pages, aggregation and checkpoint tracing per cold build | Existing five-minute cache retained and strengthened with account isolation, bounded retention, exact TTL boundary, explicit invalidation and remaining-lifetime CDN headers |
| On-device vehicle analysis | 6 × 4 = 24 ONNX tile passes plus image decode/tensor work per photo; completed results previously disappeared on view unmount | New five-minute page-memory count cache for the exact URL and inference contract, at most 32 counts |
| Roadworks | Roughly 17 pages according to the existing endpoint documentation; repeated on origin misses and partial responses | New complete-source cache, five minutes, independent of traffic-light faults |
| Car park availability | Roughly six pages according to the existing endpoint documentation | New complete-source cache, one minute; original `fetchedAt` retained |
| Traffic-light faults | Small but frequently changing feed fetched alongside expensive roadworks | Independent one-minute cache; errors never retained |

Existing rain retention/coalescing, shared browser polling resources, model initialization, service-worker offline caching, VMS `useMemo` and CDN profiles for other endpoints already cover their respective repetition. They were left in place. Live health probes do not read these result caches. Camera metadata/presigned images are not added to a server result cache.

## Implementation and lifetime

`shared/ttlCache.ts` supplies a bounded lazy-expiring LRU store and async success cache. A hit moves LRU order without renewing `storedAt` or `expiresAt`. Expiry is inclusive: `now >= expiresAt` misses. The async cache reserves an owner before starting work, coalesces identical cold calls, drops rejected loads, and prevents an invalidated old writer/cleanup from replacing or deleting its successor. Zero TTL still coalesces active work but retains no completed result.

- `server/cache/ltaSnapshots.ts`: complete paged source results, eight entries and a 4 MiB serialized-JSON retention budget per warm instance. Different endpoints, SHA-256 credential scopes and pagination limits have distinct keys. Raw keys/digests are not emitted. The existing page envelope check plus an object-record guard run before retention; this does not introduce a complete field schema for every LTA dataset. Partial/truncated loads and malformed records are rejected and retried on a future request.
- `server/traffic/speedService.ts`: at most two account-scoped summaries and 4 MiB serialized JSON. Summary and geometry consumers reuse the same heavy objects. Existing provider timestamps/`generatedAt` survive cache hits. The complete-dataset page cap remains enforced.
- Both server budgets bound retained serialized payloads, not precise JavaScript heap size or transient active loads. Oversized successful answers still return but are not retained. The indexed pending set is bounded by entry capacity; distinct overflow requests run without retention, using the existing provider limits/deadlines. These caches do not impose a new global request-admission limit.
- `src/features/vehicle-counting/countCache.ts`: only integer counts and exact-photo/inference keys in page memory. No photo bytes/results/jobs are persisted or sent to an AI service. New URLs miss even when only a signature changes: no unsafe signature stripping or assumption that two URLs contain the same pixels. Analysis uses the existing serialized queue; a later queued duplicate rechecks the completed cache before inference. Aborted/invalid counts never populate it. Empty-scene count `0` is a valid hit.
- `engine.ts` exports a version signature covering model path, decode revision, tiling, thresholds and classes. Bump the revision when replacing model bytes at the same path or changing unlisted decoding behavior. Page reload/deployment starts a new browser cache; changing the contract creates a different key.
- `vehicleJobs.ts` reads the shared cache before queue admission, so returning to the camera page reuses current-photo counts. Expiry/clear is noticed on the next camera/visibility update; no timer is kept just for expiry. The existing mounted result remains available until that update, and always describes the exact photo, not a fresh observation or a crossing-time prediction. A failed photo still follows the existing bounded retry/same-photo suppression policy.

`server/http/responses.ts::snapshotCacheHeaders` limits fresh + stale CDN windows to the snapshot's remaining lifetime, including when `CDN_CACHE_MULTIPLIER` is increased or disabled. Hits cannot restart a full lifetime. Road-condition answers use the earliest source deadline and next Singapore midnight; date filtering runs on each origin answer. Partial responses stay `no-store`; successful individual sources may still be reused. A cached success can serve until its TTL during an upstream outage, but health remains diagnostic and expired successes are not silently served by these new caches.

These are process/page-memory caches, not Vercel Runtime Cache or durable/distributed storage. Warm instances, regions and tabs have separate caches; a cold instance still performs a cold load. No new dependency, hosted service, credentials or provisioning are required.

## Invalidation and controls

Automatic invalidation: TTL expiry, LRU/budget eviction, process/page termination, changed endpoint/account/page limits, new exact photo URL or new inference contract. Roadworks date filtering is not stored, so midnight changes are reflected without fetching the raw list again.

Explicit internal controls (not unauthenticated HTTP endpoints):

```ts
// In the owning warm server instance:
import { ltaSnapshots } from '../server/cache/ltaSnapshots';
ltaSnapshots.invalidate(endpoint, accountKey, paginationLimits); // same limits as the original get
ltaSnapshots.clear(); // all paged source entries + pending ownership

import { invalidateSpeedSummary } from '../server/traffic/speedService';
invalidateSpeedSummary(accountKey);

// In the current browser page:
import { clearVehicleCountCache } from '../src/features/vehicle-counting/useVehicleCounts';
clearVehicleCountCache(); // next camera update rechecks/requeues
```

Clearing detaches pending writers so they cannot refill the cache. It does not cancel requests already accepted by callers, erase another instance/tab, or purge an already stored CDN answer. CDN copies expire within the emitted remaining deadline; immediate global purging is a separate hosting operation. User refreshes request the feed through the normal bounded cache rather than exposing a public bypass that could force hundreds of LTA calls.

Validated settings in `config/schema.ts` and generated `.env.example`:

| Setting | Default | Accepted range |
| --- | --- | --- |
| `SPEED_CACHE_TTL_MS` (existing) | 300000 | 1000–3600000 |
| `ROADWORKS_CACHE_TTL_MS` | 300000 | 0–3600000 |
| `FAULTY_LIGHTS_CACHE_TTL_MS` | 60000 | 0–300000 |
| `CARPARKS_CACHE_TTL_MS` | 60000 | 0–300000 |
| `VITE_VEHICLE_CACHE_TTL_MS` | 300000 | 0–900000 |
| `VITE_VEHICLE_CACHE_MAX_ENTRIES` | 32 | 1–128 |

New TTLs accept zero to disable completed reuse. The browser's existing mounted count may still be displayed for its exact photo when reuse is disabled; leaving/remounting recomputes it. `VITE_` changes require a rebuild. `.env.local` is never read or overwritten by the example generator.

## Verification

- Full suite: 246 passing Node tests, zero failures/skips, including the wrapper's four offline Python cases. Added 17 test groups across `caching.test.ts` and `cache-endpoints.test.ts`. Existing independent partial-outage scenarios explicitly clear the new warm cache between fixtures; a new test verifies partial-source reuse without clearing.
- Synthetic experiments: twenty overlapping car park endpoint requests produce one underlying complete-dataset load. Twenty repeated same-photo counts produce one model-call stub (19 × 24 = 456 tile passes avoided by code-derived arithmetic). Full speed builds also remain coalesced. These are deterministic workload counts, not measured real-browser inference speedups or production savings.
- Covered exact TTL, original receipt/generated time, concurrent misses, LRU/byte bounds and oversize fallback, zero counts, failures, unusable records and incomplete pagination, source/account/page isolation, explicit invalidation and late writers, browser cancellation/remount and clearing earlier failure status on a successful cached count, model-contract isolation, partial-source retries, midnight filtering and CDN lifetime composition.
- Type checking, transport audit, production build, generated-example consistency and whitespace checks passed. An initial test-fixture type check lacked the queue's required `failed` callback; supplied the synthetic callback and rechecked. No runtime workaround or relaxed check was needed.
- No real camera metadata/presigned image, user storage/permission/notification, credential values or provider outage was used. Interactive browser/performance checks remain unperformed after the prior automatic approval usage-limit block; no alternate browser/protocol workaround is used. Tests establish policies; deployment artifact checks, when recorded below, establish availability only.

Official guidance consulted: [Vercel cache-control headers](https://vercel.com/docs/caching/cache-control-headers) and [Runtime Cache](https://vercel.com/docs/caching/runtime-cache). The latter is a possible future cross-instance layer; it is not provisioned by this preview.

## Preview publication

Draft [PR #25](https://github.com/Mikazukiangus/live-traffic/pull/25) is attached to the chat. Initial implementation `eb951b909dad651983f71120dd8b109db1625754` passed both GitHub Checks runs (`40053915944`, `40053933405`) and Vercel deployment/feedback checks. CI diagnostics were read through the code-review tool.

Initial [preview](https://live-traffic-morq6ol0k-carbon-bc04.vercel.app) is deployment `dpl_2ojEEQLLB1RYTFQQLLqsSmHPvuie`, READY for the intended project/team, preview branch and implementation SHA. Authenticated homepage, its actual entry bundle and the referenced camera chunk returned HTTP 200; the camera chunk contains the model-contract cache revision. These are artifact-availability checks, not actual browser/inference or performance verification.

Final code review also found that another consumer's successful cached count needed to clear the resource's earlier same-photo error marker. Corrected that branch and extended the existing queue/cache integration test to check recovery to ready. The focused 13 cache test groups and type checking pass. The follow-up commit includes this recovery correction and the initial publication evidence; final runtime verification follows below when available. Main/production and PR #23 remain unchanged.
