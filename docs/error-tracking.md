# Centralized exception tracking in Vercel logs

The [structured-logging extension](structured-logging.md), prepared for Preview
review, unifies non-error diagnostics and adds automatic pseudonymous verified-user
context. Its production activation is separate from the PR #31 release below.

The user selected existing Vercel logs rather than a new external service. This
implementation adds no account, secret, paid integration, database table or extra
Vercel Function. It was explicitly approved and merged through PR #31; production
release verification is recorded below.

## Captured events and user experience

- Provider and application exception reporters use `shared/errorTracking.ts`.
  API exceptions retain existing safe codes/statuses and add `errorId` to their
  response. Successful feed payloads and request-validation contracts stay intact.
- `server/observability/context.ts` uses AsyncLocalStorage for a fresh server
  request ID, an allowlisted route/method and platform release/environment.
  Concurrent requests cannot overwrite each other's context. Nested live-feed
  dispatch reuses the request ID; incoming correlation headers are ignored.
- Authentication library warnings, storage errors and unavailable responses use
  the same reporter. Credentials, account/session details and library arguments
  are excluded. An ordinary rejected sign-in is not treated as an exception.
- Production browser startup installs React boundary/root reporting, window-error
  and unhandled-promise listeners. Resource-load events remain owned by existing
  camera/chunk recovery. Development fixtures explicitly install the same reporter.
- Page/root fallbacks retain recovery actions and show a reference ID. Unexpected
  global failures show a fixed, dismissible notice, even if React has unmounted.
  No exception text is rendered. Recoverable React errors are recorded without
  adding an intrusive global notice.

Browser exceptions POST a small sanitized report to `/api/live?feed=errors`.
Accepted events become `client_exception` JSON lines in the existing function's
logs. Browser release is `clientRelease`; receipt context has the server release
and server-generated request ID. Browser classifications/coordinates/reference IDs
are **client-reported advisory data**, not evidence of a verified user or server
failure. The endpoint has no account write/read operation and ignores cookies.

## Privacy and context

Each structured line includes `event`, fixed `code`, UUID `errorId`, receipt/event
timestamp, exception type, at most three numeric line/column locations, a bounded
grouping `fingerprint`, and safe context. Provider source/status and operation/scope
are selected from fixed vocabularies when relevant. Platform commit SHAs are
accepted only as 40 lowercase hexadecimal characters; absent/invalid values become
`unknown`. No environment export or new environment variable is required.

The reporter never serializes an Error or reads its message/cause. It projects a
fixed standard error type and numeric coordinates, dropping stack filenames,
functions, paths, full URLs and query strings. Hostile getters cannot break error
recovery. Arbitrary properties, request/response bodies, headers, cookies, passwords,
LTA keys, signed camera URLs, email/IP/raw user IDs, precise locations, component props,
component stacks and session replay are excluded. This is an allowlist, not a regex
that attempts to scrub arbitrary free text after collecting it.

Unknown input fields are rejected at ingestion, rather than logged for diagnosis.
No raw body or rejected input is echoed. Error notices use React text nodes or DOM
`textContent`, never HTML interpolation. An ID is safe to share for support; it is
not an authentication/session token.

## Ingestion and outage bounds

`server/observability/browserErrors.ts` handles only POST to the exact live route
and `feed=errors` selector. Duplicate/unknown/conflicting query controls, extra
payload fields, invalid versions/types/coordinates, untrusted or absent origins,
cross-site fetch metadata, non-JSON/compressed bodies and oversized input are
rejected before event emission. The existing exact-origin CORS allowlist applies;
there is no wildcard or credentialed telemetry CORS. Cross-origin preflights are
not enabled for this POST operation.

`config/policy.ts::ERROR_TRACKING` defines:

- Maximum body: 2,048 bytes, enforced on actual streamed bytes as well as a declared
  content length, including Node and Web transports.
- Body/report request deadline: 3 seconds. Browser requests are same-origin,
  no-store, no-referrer, credential-free, reject redirects and have no retries.
- Browser: at most ten distinct exception fingerprints per minute per installation;
  equivalent occurrences reuse the submitted reference ID. No persistent queue,
  replay, offline cache, cookie, local/session storage or account lookup is used.
- Server: existing public IP admission applies, plus at most sixty accepted browser
  log events per minute per warm function instance. This additional counter is a
  local log-volume budget, **not** a distributed per-user/IP limiter. Existing
  platform Firewall/rate-limit environment scope is unchanged.

Accepted reports return HTTP 202 with `{success:true,errorId}`. Rejections use safe
fixed messages, appropriate 400/403/405/408/413/415/429 status and no-store headers;
budget/rate rejections include a numeric Retry-After. Reporting failures never
recursively report, retry or prevent the app from showing its safe fallback.

Delivery is best effort. Offline clients, blockers, unloading, exhausted reporting
budgets and provider/log retention can leave a displayed reference without a
central entry. Server log delivery also depends on the host. This does not create
durable issue storage, alert rules, source-map symbolication or a Sentry-style issue
inbox. Exact raw stacks/messages are deliberately unavailable.

## Finding a report

Open the existing [live-traffic project logs](https://vercel.com/carbon-bc04/live-traffic/logs).
Select the correct environment/deployment and time range, then search for the
user's `errorId`. Follow `context.requestId` for other failure events in that
request. Group repeated failures with `fingerprint`, `context.release`, fixed
`code`, route and provider `source`. Browser reports use `client_exception` and
can be narrowed by `context.page` and `clientRelease`.

Retention and access follow the existing Vercel project settings/plan. No new
retention, external drain, billing or monitoring configuration was provisioned.
Development Vite tooling and third-party/platform logs can emit their own raw
diagnostics outside this application reporter; the development synthetic fixture
demonstrates that Vite's own error forwarding is separate. Do not put credentials
in exception messages even when application reporting excludes them. Bootstrap
failures before application initialization remain a hosting/runtime concern.

## Verification

`tests/error-tracking.test.ts` adds twelve synthetic groups for privacy, hostile
getters, correlation, concurrent/nested request isolation, logger/sink failure,
strict browser input, actual Node/Web live dispatch, body size/deadline, admission,
atomic warm-instance budget, browser deduplication/reference reuse and cleanup,
failed telemetry without recursive events, and validated release metadata.

All **311 tests** passed after the reference-ID fix, zero failures/skips. Type
checking, HTTPS/cookie source audit, production build and whitespace checks passed.
No real database/account/provider or secret export was used.

The isolated development fixture is `tests/browser/error-tracking.html`. Browser
checks triggered a page error, promise rejection and window error: safe fallbacks
and IDs were visible, and the same IDs appeared in sanitized `client_exception`
server logs. Screenshot: `/tmp/trafficpulse-safe-error-tracking.png`. A later
post-edit browser reread reached a connection-refused page during Vite restart;
the browser rejected that generated data URL. No alternate browser/protocol was
used to bypass the restriction. Final reference deduplication is covered by the
passing synthetic browser transport test; no final-build interactive pass is
claimed from the earlier screenshot.

## Preview publication — 28 October 2026

Implementation `07c9a68645ed128b171986ebe7b12d0c18f69edf` is available in draft
[PR #31](https://github.com/Mikazukiangus/live-traffic/pull/31). Both GitHub Checks
runs `40694181892` and `40694097892` and Vercel checks passed. Required CI job
`122836146071` diagnostics confirm 311 passing tests, no failures/skips, audit and
production build.

[Preview](https://live-traffic-rbxr3irtg-carbon-bc04.vercel.app) deployment
`dpl_H6re5N2495CpaiExtJ9FHMmyvfoA` is READY for the exact implementation SHA,
correct project/team and preview branch. Scoped CLI project inspection verified
`carbon-bc04/live-traffic` before the protected POST probes; no environment values
were downloaded/exported or protection changed. The fetch connector exposes GET,
so the two POST checks used authenticated `vercel curl` with generated JSON in
subprocess stdin, bounded deadlines and filtered output.

- A synthetic valid report returned HTTP 202 and its matching error ID.
- A synthetic payload with an extra free-text `message` field returned HTTP 400
  `INVALID_ERROR_REPORT`.
- A deployment-scoped Vercel runtime-log search for the valid synthetic ID returned
  the exact `client_exception` event, separate server request UUID, allowlisted
  route `errors`, release SHA, environment `preview`, page and numeric coordinates.

This establishes deployed ingestion and centralized log receipt. It does not
induce a real user error, crash production, verify every application catch site,
exercise real credentials/accounts/providers, or guarantee delivery/retention.
Production activation is still pending explicit approval to merge PR #31. The
subsequent publication note is documentation only.

## Production release — 28 October 2026

The user explicitly approved merging PR #31. Verified final head
`bb633528bc5a0ae9bb82c6f828125a1ea6ca39c5`, main target, mergeability and all
successful checks. GitHub Checks runs `40694651881` and `40694643971` passed;
required job diagnostics `122838079614` confirm 311 passing tests, zero
failures/skips, transport audit and build. Marked ready and merged with that
expected head as `87ab7e917e8c488b3bbafd64345e79abff355901`.

Production deployment `dpl_ECJPLZn8wWBwDJwyeLbmKZvVukKf` is READY for the
intended project/team, main SHA and production target, with the canonical alias
[TrafficPulse](https://live-traffic-carbon-bc04.vercel.app). Protected homepage and
its actual module entry returned HTTP 200. Scoped CLI project inspection confirmed
`carbon-bc04/live-traffic` before two authenticated, generated-data POST probes:

- Valid synthetic report: HTTP 202 with matching error ID.
- Extra free-text field: HTTP 400 `INVALID_ERROR_REPORT`.
- A production/deployment-scoped log search for the generated ID returned the
  matching `client_exception`, a separate server request UUID, allowlisted
  errors/POST route, production environment and exact server release SHA.

The submitted clientRelease was synthetic probe input, not evidence of a real
browser's metadata. No actual exception/account/provider/camera load, secret
export, production credential change or Firewall expansion was performed. These
checks establish selected deployed paths and log receipt; the earlier browser
fixture and automated transport tests cover the safe UI/reporting behavior.
The documentation follow-up can trigger another normal Git deployment without
changing the verified runtime. PRs #23 and #29 remain separate and unmerged.
