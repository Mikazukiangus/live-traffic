# Error recovery: API, pages and commute alerts

Implemented on preview branch `codex/error-recovery-boundaries`, pending explicit
approval to merge. This now addresses all five findings from Turn 136; the user
approved findings 4–5 while PR #21 was still a draft.

## API exception boundary

`server/http/validateRequest.ts` now wraps parsing, business execution and Web
response decoration in an outer safety net. Existing validation/CORS responses
and ordinary endpoint-owned error handling retain their contracts.

- Unexpected exceptions become fixed JSON `INTERNAL_ERROR` responses, HTTP 500.
- Known invalid provider payloads retain HTTP 502; typed HTTP/circuit errors retain
  safe classifications/status and numeric retry hints.
- Error responses are `no-store` for browser and CDN caches. Prepared binary length,
  encoding, validator and retry headers are removed before sending a new Node error.
- Trusted CORS headers and `Vary` survive the fallback.
- If a Node response has already started, log a fixed event and close an unfinished
  stream without passing the exception to the socket. Never attempt a second JSON
  response. Already completed responses are not rewritten.

Air-quality region metadata is checked before mapping. A malformed successful
provider response becomes a typed invalid-provider failure, not an escaped
TypeError. A valid partial answer remains usable; each rejected source is logged
independently as described below.

Module import/bootstrap failures before the request wrapper executes are still a
hosting/runtime concern. No application wrapper can rewrite a response already
sent to a client.

## Page recovery

`src/components/ErrorBoundary.tsx` provides a page boundary keyed by the selected
tab, plus a root boundary around App. Page failure leaves the navigation available.
The user gets one local **Try again**, an explicit **Reload page** action and can
switch tabs. Root failure shows a reload action and a fixed link to the cameras.
No automatic reload loop is introduced. The existing limited Vite chunk-reload
recovery remains in place.

`src/features/app/errorReporting.ts` replaces React's default raw root error logs.
The boundary owns caught-error diagnostics; uncaught/recoverable root callbacks
emit fixed classifications. Neither fallback rendering nor application diagnostic
calls receive an error message/stack, props, component stack, URL or browser event.
The boundary does not claim to catch async/event-handler failures; notification
promises are handled explicitly below.

## Commute notification outcomes

`src/features/commutes/notificationDelivery.ts` separates browser APIs from delivery
policy. Permission requests resolve to granted, denied, dismissed, unsupported or
failed outcomes. The commute card shows a fixed inline explanation, and prevents
another click while the permission request is pending. No permission prompt is
triggered automatically by retries.

Notification delivery prefers the service-worker API, then a guarded constructor
fallback. Both rejection paths are handled. `sent` means the browser accepted the
request; it does **not** prove OS display or that a person read the notification.
Failed constructor/worker combinations cannot escape as unhandled rejections.

`commuteAlertQueue.ts` owns the in-memory queue:

- The first **live** incident answer establishes the baseline. Initial errors or
  offline copies cannot turn existing incidents into new-alert candidates.
- Baseline/unwatched incidents are ignored deliberately. A candidate is recorded
  as successfully sent only after browser acceptance, with one in-flight attempt.
- A failed delivery gets at most **three total attempts**, spaced **15 seconds**
  apart, with a **two-minute** eligibility limit. Successful receipts deduplicate
  later observations. Terminal failures stay distinct from successful receipts
  and cannot restart attempts on every feed update.
- Retries are cancelled when the incident disappears, its watched commute is
  disabled/deleted, it expires, or the hook unmounts. Watch-list changes still
  cancel queued work while the feed is in an error state. Late async completions
  cannot publish notices or schedule work after disposal.
- Permission denial/unsupported APIs have no automatic retry loop. Fixed notices
  in the app explain retrying, blocked or failed delivery.

State belongs to the current open tab and is not a durable push-notification
service. Browser/OS operations already submitted cannot be recalled. Timers may
be delayed while a tab sleeps; the age limit is rechecked before another attempt.
No browser permission, real notification or user storage was changed by tests.

## Air-quality state and observation age

`useAirQuality()` now exposes the shared snapshot, including data, status, offline,
receipt time, refresh state and refresh action. The radar and camera consumers keep
that state instead of discarding it. `airFreshness.ts` projects loading, unavailable,
retained/error, offline and missing-source notices from it without mutating data.

PSI and PM2.5 each use their own observation timestamp and availability. Both are
checked against the existing validated `VITE_AIR_STALE_MS` threshold, including the
exact boundary. A fresh PSI answer cannot hide old/missing PM2.5. Headers and camera
details distinguish the two observation times and convert UTC timestamps to SGT.
Failed refreshes and offline copies never renew the original receipt or provider
observation times. Missing metrics are not assigned another source's timestamp.

Weather-panel initial failures now become unavailable instead of loading forever.
Retained/offline readings have explicit notices. Camera summaries and the enlarged
camera dialog show the same warning, including where a modal obscures the global
status notice. Shared fetch/polling ownership remains unchanged.

## Partial-source diagnostics

Air quality, lightning/WBGT and roadworks/faulty lights now log **each rejected
source once** even when its peer succeeds. Responses retain the established
uncached partial HTTP 200 contract and null unavailable fields. When both fail,
the existing failure response is preserved without duplicate diagnostic events.
A usable partial endpoint can still be UP in the health catalogue; individual
source failures are now visible in logs.

The optional diagnostic source is selected from six fixed labels: `psi`, `pm25`,
`lightning`, `wbgt`, `roadworks`, `faulty_lights`. Unknown labels are omitted.
Neither provider URLs, rejected values, error bodies, request fields nor secret
values become labels. Public error bodies do not gain source details.

## Diagnostics

`shared/applicationDiagnostics.ts` accepts only fixed operation classifications.
It never receives the original exception, notification title/body, commute name,
location, props, stack, headers or signed camera URL. Existing provider diagnostics
remain under `shared/diagnostics.ts`. No telemetry service was provisioned.

## Verification

The latest local full suite passed **203 tests** with zero skips, including 12
recovery groups and seven air/partial-source groups. Type checking, transport
security source audit, production build and whitespace checks passed. The existing
Python wrapper also ran its four offline helper cases. The new source-label test
initially sorted a shared fixture array in place; corrected the fixture to copy
before sorting, then reran successfully. Application behavior did not need changing.

Synthetic regression cases cover Node/Web exception and serialization failures,
CORS, cache-header cleanup, already-committed responses, typed provider/circuit
errors, the malformed-success air payload, permission outcomes, worker/constructor
failures, notification receipts, duplicate/in-flight suppression, bounded recovery,
expiry/watch removal/disposal and fixed root callback diagnostics. Air tests cover
initial outage, retained/offline state, independent exact-boundary observation
ages, missing metrics, original receipt preservation/recovery and distinct camera
observation times. Both Node/Web partial-source tests cover each failed peer,
both failed peers, one log per rejected source, HTTP 200/no-store partials and
rejection of untrusted source labels.

### Browser verification still pending

The isolated fixture is `tests/browser/error-recovery.html` with
`error-recovery.fixture.tsx`. It imports the actual boundary and root callbacks,
uses synthetic errors, and never loads App or requests providers, notifications,
permissions or storage. It is a development fixture, not a production build entry.

Opening `http://127.0.0.1:3195/tests/browser/error-recovery.html` through the approved
browser tool was blocked by **automatic approval review because its usage limit
was reached**. This was not a determination that the page was unsafe. No alternate
browser/automation or raw protocol workaround was used. There is **no claimed
visual/browser pass**. The isolated dev server is no longer running.

When approved browser access is available, run the normal dev server and open the
fixture path on its actual port. Check Broken tab → recovery screen → Try again
(only once) → Healthy tab; check Lazy error tab; then Crash app → root fallback.
Navigation must survive page failures, and the audit output must show
`Raw details leaked: false`. Do not exercise this against live provider data or
real notification permissions. HTTP deployment smoke checks cannot establish
these interactive recovery guarantees.

References: [React error boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary),
[browser unhandled rejections](https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event).

## First preview publication (findings 1–3)

[PR #21](https://github.com/Mikazukiangus/live-traffic/pull/21) was initially published
at `59a307b1b9a3071373e29834d83bfd640d40f66b`. Both GitHub Checks runs `39959815461`
and `39959881027`, Vercel deployment and preview-feedback checks passed. CI logs
confirmed all 196 tests passed with zero skips at that exact implementation head.

Deployment `dpl_9u3sdgUChtsaReiACf1cXHcEkaFn` was READY for the intended project/team
and preview branch. Authenticated homepage/entry bundle, incidents (9 records),
rain (47 areas) and air quality (5 regions) returned HTTP 200. This establishes
selected deployed success-path compatibility for that earlier head, not an
interactive recovery-screen pass or verification of the later findings 4–5 patch.

## Updated preview publication (all five findings)

The findings 4–5 implementation is `2a26b0a720a7acacb02bd47bb35c60ad006ac509`
on the same draft PR #21. Both GitHub Checks runs `39961050814` and `39961061360`
and Vercel deployment/preview-feedback checks passed at that head. The local
combined suite passed all 203 tests with zero skips.

Deployment `dpl_29uAXtu854bDGAzunV23T3WbRUsH` is READY for the intended project/team,
preview branch and implementation SHA:
[preview](https://live-traffic-5vo1xocvj-carbon-bc04.vercel.app).
Authenticated homepage, its actual referenced entry bundle and the updated
air-quality API returned HTTP 200; air quality contained five regions. These
verify selected deployed success paths; synthetic tests cover failures, partial
answers, log redaction and receipt preservation. Interactive browser verification
remains pending for the documented approval-review usage-limit reason.

This final publication follow-up changes documentation only. Runtime verification
is pinned to the implementation SHA above. Main/production await explicit approval.
