# Public API rate limiting

## Current status

Prepared on `codex/public-api-rate-limits`; **not active in production**.
The Vercel Firewall skill was already installed and was used for this work.
The account is **Hobby**, confirmed by the user. The design uses **one** rate-limit
rule, matching Hobby's allowance. It does not require Redis or a plan upgrade.

**Turn 153: the existing draft has now been inspected and corrected.** The official
Vercel CLI 65.2.0 worked through the documented connector fallback, after verifying
the exact project/team. CLI overview showed `active: null` and draft version 1;
the active configuration API's 404 did not establish a team authorization failure.
The original draft had exact Path equals `/api/`, plain Log, and no rate-limit
configuration. It would not match actual endpoints such as `/api/traffic`.

Corrected only existing rule `rule_traffic_pulse_public_api_rate_limit_3e38zR` in
the unpublished draft: Path **starts with** `/api/` OR SDK ID
`trafficpulse-public-api-v1`, Rate Limit, Fixed Window 300/60s, IP, Log on excess.
The connector rejected targeted edit arguments before API execution; the supported
CLI targeted update succeeded. Subsequent overview/diff checks confirmed a valid
rule, no validation errors, one rule, only insert/update changes for this rule,
and unchanged unrelated Firewall settings. **There is still no active configuration.**

The earlier automatic approval rejection of entire-configuration PUT still stands.
No whole-config overwrite, publication, production enforcement or duplicate rule
was performed. Use the known targeted draft and user publication flow below.

## Next action in the dashboard

1. Open <https://vercel.com/carbon-bc04/live-traffic/firewall>, choose **Review Changes**,
   and inspect the corrected `TrafficPulse public API rate limit` rule. The two draft
   changes are the original insertion and this targeted correction of the same rule.
2. **Publish the log-only draft yourself**, then review matching traffic at
   <https://vercel.com/carbon-bc04/live-traffic/firewall/traffic?filter=rule_traffic_pulse_public_api_rate_limit_3e38zR>.
   Publication is the missing activation step; the enabled toggle in a draft does
   not mean it is live. The Vercel Firewall skill requires user publication and
   traffic review before advancing to blocking.
3. After log review, test blocking with **Environment = Preview AND each OR group**,
   and change the rate limit's **when exceeded** action to **Default (429)**. Review
   and publish that preview-only draft yourself. This rejects excess requests,
   while an unconditional Deny on the API path would reject normal API traffic too.
4. After preview verification and production traffic review, remove both preview
   environment conditions and publish 429 enforcement for production when approved.

Native WAF IP blocking happens before the API/CDN and **does not require an app
redeploy, the PR merge, or `API_RATE_LIMIT_MODE=enforce`**. That environment setting
controls the additional application SDK admission only. Leave it off until the
SDK/protection-bypass setup and preview checks below are complete. No application
code or login change is needed just to enable the native IP rule. Per-account
enforcement remains future work while login is on hold.

`API_RATE_LIMIT_MODE=off` is the safe setup default. Deploying this branch alone
does **not** activate limiting. Complete the rollout below before claiming protection.
Application login remains on hold. There are no signed-in users to limit today;
the verified-user integration is prepared and tested, but is not connected to an
authentication provider. No new browser identifier/cookie has been added.

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

## Future verified-user integration

`createRateLimitGuard({ settings, resolveVerifiedUser })` accepts a server-side
session verifier which returns a bounded stable account ID or null. It hashes the
ID and checks a second, independent user bucket **after** the IP check. A user moving
between IPs keeps the same quota; several users behind a shared IP retain separate
user buckets and still share IP protection. The default guard intentionally has no
verifier while login is on hold. A client `userId`, cookie, arbitrary auth header,
or the provider AccountKey is not a verified application identity.

When adding authentication, wire the verifier centrally and revisit CDN delivery:
authenticated user checks must run before shared-cache hits (e.g. verified routing
middleware), or authenticated responses must bypass shared caches. The future
origin verifier hook alone cannot enforce a per-account quota on CDN hits. Do not
announce per-user protection until that full authenticated flow is implemented.

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
