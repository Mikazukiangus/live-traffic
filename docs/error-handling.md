# Error recovery: API, pages and commute alerts

Implemented on preview branch `codex/error-recovery-boundaries`, pending explicit
approval to merge. This addresses findings 1–3 from Turn 136. The separate
findings about air-quality feed state and partial-source diagnostic coverage
remain follow-up work.

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
TypeError. A valid partial answer remains usable; this change does not implement
the separate partial-failure logging recommendation.

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

## Diagnostics

`shared/applicationDiagnostics.ts` accepts only fixed operation classifications.
It never receives the original exception, notification title/body, commute name,
location, props, stack, headers or signed camera URL. Existing provider diagnostics
remain under `shared/diagnostics.ts`. No telemetry service was provisioned.

## Verification

The local full suite passed **195 tests** with zero skips before the final root
callback test was added. All **12** error-recovery groups then passed, including
that additional redaction check. Type checking, transport security source audit,
production build and whitespace checks passed. Existing Python wrapper coverage
also passed its four offline helper cases. CI verifies the final combined suite.

Synthetic regression cases cover Node/Web exception and serialization failures,
CORS, cache-header cleanup, already-committed responses, typed provider/circuit
errors, the malformed-success air payload, permission outcomes, worker/constructor
failures, notification receipts, duplicate/in-flight suppression, bounded recovery,
expiry/watch removal/disposal and fixed root callback diagnostics.

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
