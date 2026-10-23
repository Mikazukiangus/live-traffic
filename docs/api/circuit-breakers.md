# Provider circuit breakers

Implemented on preview branch `codex/provider-circuit-breakers`, pending explicit
approval to merge into main. Application login work remains on hold.

## Calls protected

Repeated live-provider reads can otherwise consume request slots and repeat retries
during an outage. Their breaker scopes are deliberately independent:

| Calls | Scope |
| --- | --- |
| LTA incidents, VMS, travel times, road works, faulty lights, car parks | One per endpoint, shared across pagination offsets within the warm instance. |
| LTA speed-band pages | One speed-band scope across every page/wave; no breaker per offset. |
| Camera metadata | Separate LTA DataMall and public data.gov.sg scopes so public fallback remains possible. |
| Camera image proxy | One per immutable allowed image hostname, never per signed URL/photo. A broken host cannot block another host. |
| data.gov.sg rain, 24-hour forecast, PSI, PM2.5, lightning, WBGT, flood alerts | One per feed. Lightning/WBGT retain separate scopes despite sharing the `/weather` path. Dates and flood pagination tokens do not create new scopes. |
| Provider health probes | Use the same local registry and report DOWN/503 when paused; no bypass, retries or cached health success. |

Browser API polling, service-worker requests, model downloads, scheduled monitoring
and the offline Overpass map-generation helper gain no second breaker/retry layer.
The recurring provider reads above own outage suppression. Offline operations and
static downloads already have bounded attempts/deadlines and are not a recurring
server dependency fan-out.

## Defaults and state changes

Validated private settings in `config/schema.ts` generate `.env.example`:

```dotenv
PROVIDER_CIRCUIT_FAILURE_THRESHOLD=5
PROVIDER_CIRCUIT_WINDOW_MS=60000
PROVIDER_CIRCUIT_COOLDOWN_MS=30000
```

- Closed: admit requests. Five failed logical reads within 60 seconds open the
  circuit. A successful read clears the recent failures; old failures expire.
- Open: reject new reads immediately for 30 seconds without fetch, pacing or retries.
  Rejected reads do not extend the pause. Fresh completed caches can still serve.
- Half-open: at expiry, admit one recovery operation with **one physical attempt**.
  Concurrent requests are rejected until that operation ends. Success closes the
  circuit; a qualifying failure starts another 30-second pause. A neutral result
  such as 401/429/caller cancellation releases the trial for another request without
  claiming provider recovery or extending the outage cooldown.

Requests already on the wire are allowed to finish. A generation check prevents
old results from closing a newly opened circuit, extending its pause, or undoing
later recovery. Already admitted retry loops check their permit before another
attempt; a concurrent trip stops their next fetch. Weather queue waiters also
recheck before fetching.

The breaker wraps the existing retry owner. Up to three ordinary/four speed attempts
(or two camera/weather attempts) count as **one final operation outcome**, not one
failure per attempt. Existing overall deadlines, pacing and Retry-After limits
remain. Neither the transport nor browser introduces another immediate retry loop.

## Failure classification and responses

Qualifying failures: HTTP 408/500/502/503/504, explicitly known transient connection
and timeout errors, malformed JSON and typed invalid upstream payloads. Invalid
payloads still fail immediately without retries; repeated contract failures can
pause a feed. Weather's v2 envelope now uses `InvalidPayloadError`. Endpoint-specific
normalization outside that client is not counted as a transport/envelope failure.

Excluded: HTTP 429 (existing weather cooldown/backoff policy), auth/permanent HTTP
errors, caller cancellation (including a caller-supplied timeout reason), unknown
exceptions, TLS/redirect errors and SSRF/URL/DNS policy rejections. These do not
count as evidence of a provider outage. DNS guard failures remain fail-closed.

An admission rejection uses a fixed `CircuitOpenError` with status 503 and a numeric
retry time. API error responses use `UPSTREAM_CIRCUIT_OPEN`, `Cache-Control: no-store`
and a positive numeric `Retry-After` in seconds. No upstream body, raw exception,
URL, signature, key, headers or stack appears in diagnostics. The request that
first trips the breaker retains its original final error; subsequent calls see
the temporary admission failure. While a recovery probe is in progress, peers get
a short retry hint; they cannot launch a second probe.

Multi-source APIs keep returning uncached partial data when one source succeeds.
If all fail, a circuit-open reason is preserved as a temporary 503 where available.
Primary camera failure still permits the independent public fallback. Rain may
retain an otherwise valid observation with its **original** receipt and published
validity; retention never renews freshness. If retention is unavailable/expired,
its cached circuit cooldown retains 503 semantics rather than becoming a 429.

## Ownership and limits

- `server/http/circuitBreaker.ts`: clock-driven state machine and outage policy.
- `server/http/providerCircuits.ts`: finite stable scope catalogue and singleton.
- `server/http/readProvider.ts` / `server/providers/dataGovClient.ts`: logical-read
  integration, existing retry/deadline ownership and single-attempt recovery.
- `server/http/providerFailure.ts`: safe HTTP status/header projection.
- `shared/diagnostics.ts`: fixed circuit error classification.

**State is per warm function instance.** Separate Vercel functions, regions,
replicas, cold starts and deploys do not share it; a cold instance starts closed.
Health and application calls consult the same registry only when executing in the
same instance. This reduces repeated work in warm instances, not provider-wide
traffic or a global quota. No database/Redis, new infrastructure, distributed lock
or global rate-limit claim is introduced. A future shared circuit would need an
atomic shared store with expiry and single-probe ownership, explicitly provisioned
and verified before promising cross-instance protection.

Only configured feed endpoints and the fixed image-host allowlist receive scopes.
Unregistered future endpoints do not silently allocate URL-keyed state: register
new dependencies in the catalogue and add isolation/recovery tests. Security URL
validation remains owned by the existing guarded transport and request boundary;
the catalogue is not an outbound allowlist.

## Verification

All **184 Node tests passed**, with zero skips, including 11 new breaker groups
and the existing wrapper running four offline Python cases. Type checking,
transport security audit, production build and whitespace checks passed.

Synthetic tests cover thresholds and exact window/cooldown boundaries, success
reset, independent instances/feeds, neutral errors/caller abort, one recovery
probe, failure reopening, stale in-flight generation races, stable pagination and
signed-image scopes, retry counts/cancellation of later attempts, weather pending
coalescing/pacing, rain retention age/expiry, Node/Web 503/no-store/Retry-After,
health fast failure, camera fallback and partial/all-failed feed behavior.

No live outage/rate limit, real camera metadata or signed image probe was induced.
No package, lockfile, hosted setting, credential or user storage changed.

Pattern reference: [Microsoft, Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker).

### Preview publication

[Draft PR #20](https://github.com/Mikazukiangus/live-traffic/pull/20) contains
implementation `66c8f1fe4091821246f7d6ac1f08833291a5d57a`. Both GitHub Checks runs
`39909291418` and `39909323332` completed successfully at that exact head, as did
Vercel deployment/feedback checks.

Deployment `dpl_CGjHyZM9iiDYsXMBEtq3kPFZHuHB` is READY for the intended project,
preview branch and implementation SHA:
[preview](https://live-traffic-o1uc35ysw-carbon-bc04.vercel.app).
Authenticated homepage, its actual referenced entry bundle, `/api/traffic` and
`/api/rainforecast` returned HTTP 200. Incidents contained 21 records at the check;
rain contained all 47 forecast areas. This verifies deployed success-path
compatibility; synthetic tests establish circuit outage/recovery behavior without
intentionally disrupting a live provider.

This publication follow-up changes documentation only. Runtime verification is
pinned to the implementation SHA above; main/production await explicit approval.
