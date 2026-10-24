# Public API rate limiting

## Current status

Prepared on `codex/public-api-rate-limits` / draft PR #28. The user explicitly
instructed the agent to publish using the CLI, superseding the skill's default
user-publication workflow for this concrete draft.

**Active Firewall version 2 enforces Preview-only HTTP 429**, with no pending draft.
The single Hobby-compatible rule remains fixed-window 300 requests per 60 seconds,
IP key; both the `/api/` and SDK-ID OR groups require environment Preview. Inspected
the full diff and published only that existing rule update with official CLI 65.2.0.
No global protection, secret, application environment or production scope changed.
Production is excluded from this custom rule, including its earlier logging.

A bounded probe against the protected Preview `/api/rainforecast?limit=0` made 305
requests in approximately 16.4 seconds: exactly 300 validation errors (HTTP 400),
then five HTTP 429 responses. Invalid requests exit before provider work; no camera,
weather, account or production load was used. The single request in the next window returned HTTP 400 again (2.019 seconds),
confirming recovery. Rule-filtered aggregate traffic independently records exactly
five rate-limit events, without client-IP/header inspection.
This establishes the native edge IP threshold for one client/region/window, not a
global quota, production throttling or isolated account-threshold exhaustion.

The application SDK remains **observe**: actual verified-account admission readiness
was confirmed in Turn 156, but middleware does not turn SDK account/IP rejections
into HTTP errors until enforce mode is approved/configured and redeployed. Native
WAF IP enforcement operates before CDN and does not need the PR merged or SDK mode
changed. Production login stays disabled. No runtime source change or merge was
performed in Turn 157. Read `authentication.md` for operator-created login.

## Next rollout actions

- Review rule-filtered traffic at
  <https://vercel.com/carbon-bc04/live-traffic/firewall/traffic?filter=rule_traffic_pulse_public_api_rate_limit_3e38zR>.
- Keep Preview conditions in both OR groups. Do not recreate the existing rule or
  publish a nonexistent draft. Read current configuration before any further change.
- SDK enforce mode and production expansion remain separate rollout steps requiring
  review; do not interpret Preview publication as production or main-merge approval.
- The earlier automatic-review rejection of a whole-config overwrite still stands.
  Use narrowly scoped rule edits; the log contains previous setup/inspection history.

## One rule for Hobby

Policy is centralized in `config/rateLimitPolicy.ts`:

| Setting | Value |
| --- | --- |
| Name | TrafficPulse public API rate limit |
| SDK Rate Limit ID | `trafficpulse-public-api-v1` |
| Algorithm | Fixed window |
| Window | 60 seconds |
| Allowed requests per bucket | 300 |
| Counting key | IP (SDK checks supply their own opaque keys) |
| Initial excess action | Log |

Use two **OR groups** in this single rule:

1. Path starts with `/api/`.
2. `@vercel/firewall` Rate Limit ID equals `trafficpulse-public-api-v1`.

Physical API requests use Vercel's client-IP bucket, including CDN hits, all methods,
and invalid requests. SDK calls use separate hashed IP or verified-user keys in the
same rule. The SDK replaces the IP counting key with its custom key; identifiers
never include URLs, query strings, provider credentials or an attacker-supplied user ID.
Origin keys are separated by dimension and production/preview namespace. Physical
edge IP buckets share the rule across project deployments, including preview.

This deliberately uses the same threshold for each dimension to fit Hobby's one-rule
limit. Independent thresholds for users, images, health, and expensive feeds would
need more rules/a different shared limiter. Native counters are **per region**, not a
single global exact quota; fixed-window boundaries can allow two adjacent bursts.
300/minute is a generous starting point for dashboard polling and multiple tabs;
review actual shared-network traffic before blocking. NAT users share an edge quota.

## Rollout and explicit activation

Open <https://vercel.com/carbon-bc04/live-traffic/firewall>.
The steps below describe the complete rollout/reference for fresh setup. Version 2
is already published for Preview; do not recreate the rule or repeat old steps.
The following is a reference sequence for fresh setup, not pending work.

1. Create the single rule above as a **log-only draft**. Preserve existing rules,
   managed protections, bypasses and firewall settings. If the UI does not support
   the OR groups, stop and inspect the draft/API representation; do not publish an
   approximate rule. Confirm any dashboard pricing/allowance notice yourself.
2. Review the complete draft and publish the **log-only** rule yourself. The Firewall
   skill requires user review/publication. Record its generated `rule_...` ID and
   inspect the rule's filtered traffic view. No blocking occurs in this stage.
3. Ensure automatic Vercel system variables are enabled and configure the required
   protection-bypass secret in Vercel for SDK calls to a protected deployment. A
   GitHub Actions secret alone is not an application environment variable. Never
   paste a token in chat or source control. Keep Deployment Protection enabled.
4. Set `API_RATE_LIMIT_MODE=observe` **only for this preview branch** and redeploy.
   Check the initial request in the preview and the Firewall traffic for both OR
   groups. `api_rate_limit/unavailable` means setup is incomplete, not a passing test.
   Do not stress production or request real camera metadata to test throttling.
5. After reviewing logs, test blocking in preview: add `environment = preview` to
   **both OR groups**, change excess action to default **429**, inspect the draft,
   and publish yourself. Set preview mode to `enforce` and redeploy. Use an agreed
   synthetic preview-only probe; verify both the physical edge and SDK buckets,
   missing-rule behavior and protected SDK access. The existing production remains
   unaffected. Hobby cannot retain a second production log rule alongside it.
6. After preview approval, approve the code merge separately. Review production
   log data before changing to production blocking: restore log-only all-environment
   coverage if more observation is needed. Once approved, remove both preview-only
   conditions, use excess action **429**, review/publish, and enable production
   `API_RATE_LIMIT_MODE=enforce` with a redeploy. Keep the dashboard available for
   rollback. Native edge rejection can be a platform response, not our JSON.

For CLI users, first link to **this exact project** with `vercel link --scope
carbon-bc04 --project live-traffic`, then inspect `vercel firewall overview` and
`vercel firewall diff`. `node --import tsx scripts/rate-limit-rules.ts` emits the
reviewable log-only add command as JSON argument arrays; it **never executes it**.
Do not add a duplicate if the dashboard rule already exists. CLI availability,
login, and successfully staged/published rules are not implied by this repository.

Rollback has two parts: set application mode to `off` and redeploy for origin
admission, and change the platform rule to Log/disable it and publish for edge
enforcement. Changing the application setting alone does not disable the WAF.

## Application behavior

Every public API module enters `withRequestSchema`, directly or through list
pagination: incidents, cameras, speed bands, expressway summaries, VMS, travel
times, image proxy, health, rain, 24-hour forecast, air, and the live feed dispatcher
with car parks, road conditions, lightning/heat and floods. Existing schema/CORS
validation and OPTIONS run first; admitted business/provider/cache work runs next.

On a cache miss the SDK consumes one origin IP bucket before business logic.
Changing route, paging, query, provider key or forged user headers does not reset it.
IPv4-mapped addresses normalize to IPv4, and IPv6 origin keys group a /64 to prevent
suffix rotation. The physical edge rule counts exact platform IPs; it does not
apply that /64 grouping. There is no trusted forwarded-header fallback outside
Vercel; local/other hosts in enforce mode return unavailable, not false protection.
Development stays off unless explicitly changed. No process-local counter is
represented as a shared serverless limiter.

`AsyncLocalStorage` admits nested `/api/live` dispatch once while independent
requests each consume quota. Each SDK check has a 1-second default deadline and
**no retries** (a lost reply may already have consumed quota). Missing/blocked
rules, SDK errors, invalid/missing IP metadata, verifier failures and deadlines
fail closed with safe 503 in enforce mode. Observe records fixed outcomes and
continues; it is **not** protection. Fixed outcome logging is capped at once per
minute per outcome per warm guard. Off does no lookup or logging.

The SDK outbound host is pinned to validated platform-owned `VERCEL_URL`, constrained
to `.vercel.app`. Incoming Host, original headers, cookies, query strings, and LTA
keys are never forwarded to it. The SDK may attach its own configured platform
automation secret; keep that environment value server-only.

Origin rejections are `429 RATE_LIMITED` with `Retry-After: 60`; unavailable checks
are `503 RATE_LIMIT_UNAVAILABLE` with `Retry-After: 5`. Both have browser, generic CDN
and Vercel CDN `no-store`, fixed JSON and existing allowed-origin CORS. Allowed
cross-origin callers may read Retry-After. No caller-specific remaining/reset
headers or cookies contaminate shared successful feed/image caches. Existing
cache TTLs remain intact. The service worker does not cache non-2xx replies or
replace a received 429 with an old offline success. The current browser JSON feed
client honors numeric Retry-After; native WAF responses must also be checked during
rollout because their shape and headers are platform-controlled.

## Verified-user integration

`proxy.ts` invokes `server/auth/userAdmission.ts` before the CDN. When enabled,
it verifies the shared authoritative database session, hashes its bounded account ID
and checks an independent account bucket. IP changes keep the same account quota;
accounts behind NAT have independent account counters and still share IP protection.
The existing origin guard remains IP-only so it does not charge the account twice.
Its resolver factory seam remains available for tests/other deployments.

A cookie only selects whether verification is needed. Client user IDs, arbitrary
headers, provider keys, invalid or revoked cookies cannot supply authenticated
identity. Auth storage/check failures return safe no-store 503 in enforce mode;
excess account usage returns 429 with Retry-After. Observe permits requests while
logging fixed outcomes. Auth endpoints have separate shared atomic IP attempt budgets.
Public feed bodies/cache contracts remain unchanged after admission. Optional login
cannot identify a signed-out person across networks. See `authentication.md` for
sessions, cookie/worker privacy, operator enrollment and current preview status.

## Verification

Synthetic tests cover independent concurrent admissions, IP normalization and
ambiguous metadata, account/IP separation, forged identity resistance, nested
dispatch, Node/Web 429/503+CORS+no-store, method/preflight precedence, deadlines,
missing rules, fail-closed errors, observe/off, minimal SDK transport and settings.
An isolated production-mode fixture exercises every actual endpoint with intercepted
SDK requests; no live providers, real camera metadata or presigned images are used.

These verify the application integration, **not** a real WAF rollout, remote
counter atomicity, browser performance or production traffic behavior. Complete
the deployment steps before considering this task activated.

Published as [draft PR #28](https://github.com/Mikazukiangus/live-traffic/pull/28).
Implementation `8d1ac9ea2af7e406a8a1e8d025bf5c64a509ce92` passed both GitHub Checks
runs (40078047859, 40078073915): 287 tests, no failures/skips, type checking, audit
and build. Preview deployment `dpl_8F7wkKQGAXn37eAbm6S7jMgDEEY1` is READY for the
correct project/branch/SHA at
<https://live-traffic-rgnqeaglv-carbon-bc04.vercel.app>.
Protected homepage returned 200, and `/api/rainforecast?limit=0` returned safe
400 INVALID_REQUEST without provider work. These are selected deployment/import
checks, not active throttling/traffic, live provider health or browser verification.

Official references: [Rate Limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk),
[WAF limits and rollout](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting),
[trusted platform headers](https://vercel.com/docs/headers/request-headers).


### Resumed authentication verification (Turns 155–156)

The current preview source adds twelve authentication groups, bringing the local
suite to 299 passing tests with zero failures/skips; type checking, audit and build
also pass. A separate real preview PostgreSQL migration and synthetic login/session/
logout check passed and cleaned its account rows. The older deployment above is
evidence for the previous IP-only foundation, not the new authentication source.
Deployment verification and published preview quota rejection/recovery remain
separate gates. Main and production are unchanged.


Final preview source 5a4d5cdfd8de4c32f180374f19100a6a7ed0f385 is READY at
https://live-traffic-et2v7hq8q-carbon-bc04.vercel.app. CI confirms 299 tests, no
failures/skips, and audit/type check/build. Deployed synthetic authentication and
revocation passed; fixed RATE_LIMIT_ALLOWED runtime evidence confirms a verified
account traversed the pre-cache SDK check successfully in observe mode. The public
24-hour forecast URL still returns its paginated result through the combined live
function. This fits eleven API functions plus one proxy on Hobby.

At the end of Turn 156, v1 was Log and v2 was a draft. Turn 157 supersedes that
state: the user explicitly requested CLI publication, v2 is active for Preview and
actual native 429 rejection was verified. SDK enforce mode and production rollout
remain pending. Read `authentication.md` for operator
account creation and the isolated database. No real account was created.


### Turn 157 publication and recovery

User authorization: “Use vercel cli to publish for me”. Official CLI publish
succeeded; active readback is version 2 and draft is null. The reviewed change
remained one existing rule update with Preview in both OR groups; all unrelated
protection settings were preserved. A 305-request Preview-only invalid-input probe
completed in 16.421 seconds: 300 HTTP 400, five HTTP 429. The next-window recovery
request returned HTTP 400 in 2.019 seconds. Aggregate traffic for the exact rule
shows five rate-limit events. No provider/production load, user account or browser
state was used. No runtime changes or broad test rerun were needed. SDK observe,
production exclusion, regional-counter limits and pending main merge remain.
