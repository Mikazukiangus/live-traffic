# Outbound request timeouts

Released to main through PR #18 as `dc91035` on 22 October 2026 (SGT).
Audit date: 22 October 2026 (SGT).

Review: [PR #18](https://github.com/Mikazukiangus/live-traffic/pull/18).
Implementation commit `27b8b25` passed both GitHub Checks runs and Vercel checks.
Its [preview](https://live-traffic-qaz26yspt-carbon-bc04.vercel.app) is READY.
The final PR head `e2d1a6e` also passed both GitHub Checks runs and Vercel checks
before the approved merge. Production deployment `dpl_kPTPCPYusXt3AT8JBYh4JdRV4Rnb`
is READY for the merge commit and assigned to the
[production site](https://live-traffic-carbon-bc04.vercel.app).

## Request inventory

| Request path | Deadline and behavior |
| --- | --- |
| Browser shared traffic/weather resources → `fetchFeed` → `fetchWithTimeout` | 30 seconds including JSON consumption. Speed summaries/geometry use 90 seconds for cold server aggregation. The shared pending entry is removed after success, error or timeout, permitting another refresh. Existing retained-data/error/retry policies still apply. |
| Browser camera metadata → internal API, then public keyless fallback | 30 seconds per source, including schema validation/body consumption. A primary timeout takes the existing fallback path; two failed sources mark the feed unavailable and permit later polling. |
| Shared browser health request and individual modal pings | Existing health deadline: 30 seconds. Other pings use their route's request/speed deadline. Pings cancel the unused body after headers; full health checks validate JSON within the deadline. |
| Vehicle counting → camera image | 30 seconds to load the image. Timeout removes its `src`, detaches callbacks and rejects with a fixed TimeoutError. |
| Vehicle counting → model and WASM binary | Explicit abortable downloads, including full array-buffer reads. A shared 60-second runtime-start budget covers module loading, both downloads and session creation. The pinned runtime receives the downloaded bytes instead of fetching these files internally. Its initialization timeout is also set. Late-created sessions are released after a deadline. |
| Service worker → network-first API requests | 24 seconds for ordinary feeds, 72 seconds for speeds: 80% of the browser budget so a completed cached fallback can reach the caller before its timeout. Timeout never replaces a complete cached observation with partial data or renews its saved receipt time. Caller cancellation is preserved. |
| Service worker → shell/navigation, fonts, uncached build assets, install precache | 30 seconds for shell/font reads, 60 seconds for assets and each install request. Fetch/body reads are bounded, including opaque font cache writes. Existing successful cache hits do not make outbound calls. |
| Server health probes → LTA/image/weather providers | Already bounded: 8 seconds per probe attempt, with the existing paced weather gate. |
| Server LTA generic/page/speed requests, camera sources and image proxy | Already bounded: 15 seconds per outbound attempt, including response reads. Existing finite retry/backoff/page limits remain. The SSRF-protected transport now supplies this default when a caller omits a signal; existing explicit deadline signals are preserved. |
| Server data.gov.sg requests | Already bounded: 10 seconds per attempt; health probes supply their 8-second budget. Existing pacing and bounded 429 retry/cooldown remain. These are per-attempt network deadlines, not a new total queue/aggregation deadline. |
| Offline base-map generator (`scripts/build-basemap.py`) | Already has a configurable 180-second socket timeout and finite retries. |
| Scheduled health workflow (`.github/workflows/health.yml`) | Already uses curl's configurable 60-second maximum transfer time, with one bounded retry and a five-minute job limit. |

The injected `deps.fetch` calls in polled/speed/rain resources use `fetchFeed`; they
are not additional unbounded transports. The server rain service similarly uses
the existing bounded data.gov.sg client. No Axios, application WebSocket,
EventSource, Node HTTP request client or XMLHttpRequest transport was found.

## Configuration

Validated public build settings in `config/schema.ts`:

```dotenv
VITE_REQUEST_TIMEOUT_MS=30000
VITE_SPEED_REQUEST_TIMEOUT_MS=90000
VITE_ASSET_TIMEOUT_MS=60000
VITE_HEALTH_TIMEOUT_MS=30000
```

They are included in the generated `.env.example`. Existing private/server timeout
settings remain `REQUEST_TIMEOUT_MS`, `DATA_GOV_TIMEOUT_MS` and
`HEALTH_PROBE_TIMEOUT_MS`; tooling/CI have their own documented settings.
No local secrets or hosted environment values were changed.

Vite renders only the validated public numeric timeout policy into `dist/sw.js`.
`public/sw.js` is a build template; do not deploy it by copying it without running
the normal build. Build tests verify public overrides reach the worker and private
settings do not. No runtime configuration fetch is needed to start it.

## Guarantees and limits

`shared/requestDeadline.ts` aborts the underlying operation and bounds the awaited
promise, keeps the deadline through body consumption, preserves caller cancellation,
and clears timers/listeners on completion. Its timeout error contains no URL,
credential, response body or cause. Existing diagnostics map it to UPSTREAM_TIMEOUT.

Regular HTML images, stylesheet/script tags, browser-managed module imports and
service-worker registration do not accept an application AbortSignal. We have not
replaced all browser resource loading. Intercepted worker cache misses and the
vehicle-runtime consumer have deadlines; a timed-out native module import itself
may still finish in the browser. Inference computation after startup is local work,
not an outbound request. The login proposal remains on hold.

The server's existing per-attempt AbortSignal timeouts remain active while handlers
consume their bodies. They do not stop all work in an unrelated shared aggregation
when a single viewer disconnects. Native cancellation behavior is documented in
[AbortSignal timeout](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
and [combined signals](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static).

## Verification

- Nine new timeout test groups cover stalled work, native HTTP headers followed by
  a stalled body, actual connection closure, caller cancellation, successful timer
  cleanup, coalesced feed retry, camera fallback, image cleanup, configuration and
  server defaults, worker fallback/receipt age, stalled bodies, cache misses,
  fonts and install requests.
- All 164 tests passed, together with type checking, transport security audit and
  a production build. The built worker contains the rendered policy; an existing
  build test also verifies custom values and secret exclusion.
- An isolated local browser fixture counted a synthetic blank image successfully
  (`Success: 0 vehicles in synthetic image`) using the actual model, WASM runtime
  and worker. No real camera metadata, presigned image links or provider credentials
  were requested by this fixture. Temporary fixture/tab/server were removed.
- Authenticated deployed preview requests returned HTTP 200 for the homepage,
  its actual entry bundle and the service worker. The worker contains the expected
  public timeout policy with no unresolved build marker. The rain endpoint returned
  HTTP 200 with all 47 forecast areas. No signed camera feed was used for this smoke
  check. Hosted environment and deployment-protection settings were unchanged.
- After the approved merge, production homepage, actual entry bundle and worker
  returned HTTP 200. The worker contains the expected 30000/90000/60000 timeout
  policy with no unresolved marker. The production rain endpoint returned HTTP 200
  with 47 areas. This is selected release smoke coverage; the deterministic stall,
  cancellation and fallback matrix remains established by the 164 passing tests.
