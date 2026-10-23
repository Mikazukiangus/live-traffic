# Safe read retries

Released to main through PR #19 as `3a16828` on 23 October 2026 (SGT).
Application login work remains on hold.

Review: [PR #19](https://github.com/Mikazukiangus/live-traffic/pull/19).
Implementation `33d17b8` passed both GitHub Checks runs and Vercel checks.
Its [preview](https://live-traffic-knt2da8ch-carbon-bc04.vercel.app) is READY.
Final PR head `8fe2076` also passed both GitHub Checks runs and Vercel checks
before the approved merge.
Production deployment `dpl_Bir2cTBcmPvGacpGJR1CvgbpR3yx` is READY for merge
`3a16828` and assigned to the production aliases.

## Where retries happen

| Operation | Retry owner and limit |
| --- | --- |
| LTA incidents/VMS/travel-time and other shared LTA GETs | `server/http/readProvider.ts`; up to `LTA_MAX_ATTEMPTS` (default 3). |
| General LTA pagination | Same reader, once per failed page. Existing page/wave limits remain. The previous loop that retried every HTTP error is removed. |
| LTA speed-band pages | Same reader, up to `SPEED_MAX_ATTEMPTS` (default 4). The previous catch-all retry loop is removed. |
| Camera metadata primary/public fallback and immutable image-proxy GETs | Same reader, at most 2 attempts per source, or the lower configured LTA attempt limit. Metadata still falls back to the separate public source. Expired/forbidden signed images are not repeatedly fetched. |
| data.gov.sg weather/hazard GETs | Its existing coalesced/paced client; at most 2 attempts. Retries re-enter the same pacing gate. Existing rate-limit cooldown/retained-data behavior remains. |
| Health probes | Single attempt. `retry: false` disables all weather retries, not just rate-limit retries. Health reports actual failures without recovering them through hidden retries. |
| Offline Overpass map query | `scripts/overpass_http.py`; up to configured 4 attempts by default. Its POST contains the generator's fixed **read-only** interpreter query. This explicitly known semantic exception does not enable arbitrary POST retries. |
| Browser feeds/camera fallback, worker, model downloads | No extra immediate retry layer added. Keep existing polling, coalescing, fallback and timeout behavior, avoiding multiplication of server retry loops. |
| Scheduled production health workflow | Existing bounded GET recheck remains unchanged; this is a separate monitoring observation. |

The low-level SSRF-protected `fetchProvider` does not retry globally. Each provider
operation has exactly one retry owner. No application write endpoint exists today.
If a future write is introduced, an idempotency header alone does not authorize
replay: design and verify the server's deduplication contract first.

## Safe conditions

The shared server reader repeats only **GET/HEAD with no request body**. Other
methods receive at most one attempt, even if configured with a higher limit.

Retryable HTTP statuses are the closed set **408, 429, 500, 502, 503, 504**.
Known transient network codes include connection resets/refusals, pipe/socket
closure, connect/body/header timeouts and temporary DNS/network reachability
errors. Generic TypeError/message matching is not enough to justify a retry.

Authentication/authorization failures, other permanent 4xx/5xx statuses, malformed
JSON, invalid schemas/envelopes, cancellation, redirect/TLS failures and SSRF/URL/DNS
guard errors fail promptly. Guard-generated DNS failures remain fail-closed even
when the underlying resolver might have been temporarily unavailable. Health and
validation failures are not retried to hide an invalid upstream contract.

Every production attempt still passes through the existing HTTPS/443 camera-host
and public-IP/DNS checks, guarded dispatcher, certificate validation and mandatory
no-redirect policy. Signed URL bytes and credential headers remain unchanged.
No raw error, provider body, key, header value or signed URL enters retry logs.

## Backoff, hints and deadlines

- Exponential delay starts at `LTA_RETRY_DELAY_MS=400`, with 0–25% jitter and
  a `PROVIDER_RETRY_MAX_WAIT_MS=12000` cap. Speed retries therefore normally wait
  about 400–500, 800–1000 and 1600–2000 ms before their additional attempts.
- Valid `Retry-After` seconds or HTTP dates are a minimum. If that minimum exceeds
  the inline cap or remaining deadline, stop instead of shortening it. Numeric
  overflow cannot become an immediate retry. Error responses preserve `no-store`;
  representable retry timing is forwarded as a safe numeric header on LTA/camera
  errors.
- All attempts, body consumption and waits in one LTA/page/image read share the
  original `REQUEST_TIMEOUT_MS` budget (15 seconds by default). A timeout that uses
  the entire budget leaves no time for another attempt. Cancellation interrupts
  backoff and prevents another request; attempts cannot multiply the deadline.
- Weather retains its 10-second per-attempt timeout and gains a 25-second total
  budget **after initial queue pacing**, covering both attempts, subsequent pacing,
  body reads and delay. Initial queue time is separate. A 429 uses the existing
  10-second fallback base/cooldown when no valid hint exists; other transient
  failures use the 400 ms base. The configured 12-second maximum inline wait stays.
- Overpass uses the existing 180-second per-attempt socket timeout, a 20-second
  exponential base with jitter and a new 120-second inline wait cap. It does not
  sleep after its final failure. Retries are for known read-only queries only;
  authentication, TLS, schema/parse and other permanent failures stop immediately.

No new distributed rate limiter or cross-instance cooldown is claimed. Weather
pacing/cooldown and pending coalescing remain instance-local. The browser's shorter
offline fallback window may return retained data while a bounded server read is
still in progress; receipt times/freshness are not renewed by a failed refresh.

## Configuration and ownership

`config/schema.ts` remains the validated source of truth; `.env.example` was
regenerated. New server/tool settings are:

```dotenv
PROVIDER_RETRY_MAX_WAIT_MS=12000
DATA_GOV_REQUEST_BUDGET_MS=25000
OVERPASS_MAX_RETRY_WAIT_MS=120000
```

`shared/readRetry.ts` owns pure classification/delay policy.
`shared/requestDeadline.ts` owns deadlines and cancellable sleeps.
`server/http/readProvider.ts` owns server read retries/HTTP hints/body disposal.
The paced weather client and Python helper retain their distinct ownership.

## Verification

All **173 Node tests passed**, including eight new read-retry groups and an
optional-Python test wrapper that ran four offline Python cases successfully.
Type checking, security source audit, production build and whitespace checks passed.
Tests cover attempt counts, exponential/jitter caps, Retry-After seconds/dates and
overflow, permanent/security/schema errors, unsafe methods/bodies, cancellation,
one total deadline, exact signed bytes, discarded bodies, paced weather recovery,
no retries for probes, LTA page integration and redacted diagnostics. Existing
Node/Web error contracts continue to verify `no-store` and response statuses.

No live failure, rate limit or user lockout was induced for these tests. The map
generator's production data was not regenerated; Python fixtures performed no
network operations. Packages, lockfiles, credentials and hosted settings are unchanged.

Authenticated deployed preview smoke checks returned HTTP 200 for the homepage,
LTA incidents (21 source records at the check) and rain (47 forecast areas). These
verify deployed provider/response compatibility; synthetic tests establish retry
behavior without inducing upstream failures or accessing presigned camera feeds.

After the approved merge, authenticated production homepage, its referenced entry
bundle, LTA incidents and rain returned HTTP 200. Incidents contained 22 source
records at the check; rain had 47 areas. These are selected release smoke checks,
not live failure injection or a new benchmark of retry behavior.

Semantics reference: [RFC 9110, idempotent methods and retry behavior](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2),
[Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).

## Circuit-breaker follow-up

[Provider circuit breakers](circuit-breakers.md), released through PR #20 as
`18eac9d`, wrap final logical-read outcomes and restrict half-open recovery to one
attempt. Ordinary closed-state retry policy above is preserved.
