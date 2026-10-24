# TrafficPulse — cloud workspace handoff

Prepared 22 October 2026; release status refreshed 24 October 2026 (Asia/Singapore). Repository:
<https://github.com/Mikazukiangus/live-traffic>.

## Start here

Continue development from the **latest `main`**. Read this note, the standing
instructions at the top of `CHAT_COMMENTS_AND_INSTRUCTIONS.md`, and its latest
turns before working. Also follow the new workspace's platform/AGENTS instructions.

Snapshot before this handoff: main `121496926c6376d94ee0b04619db5ad672e6c201`.
Fetch current main to include this handoff and its log entry; do not reset to that
older snapshot. The local checkout had no tracked changes and only a pre-existing
untracked `.claude/` directory. No local-only implementation needs recovering.

**The latest approved implementation is released.** PR #27 (weather result caching) is merged as
`406fd7a3cd667eef8e158192038d7091dc57087f`, following PR #26's list pagination, PR #25's repeated-operation caching, PR #24's device-local background queue, PR #22's atomic request updates, PR #21's error handling, PR #20's circuit breakers, PR #19's retries and PR #18's timeouts.
**PR #23 remains open/draft/unmerged:** cross-tab commute storage and wake-lock ownership on `codex/cross-tab-atomic-storage`, last published head `58ba18bfd6fa6c0de25a3919c98a49f4ccb6e812`. Do not merge it without explicit approval. It touches the commute receipt effect changed by PR #24; preserve the background-history wrapper around its coordinated repository call when integrating it. Turn 143 is recorded on that pending branch; current main has Turns 144–145 for the queue preview/release.
**Caching PR #25 was explicitly approved and merged.** Final preview head
`ef0a93910174b6a1d10684137180003abdf52479` passed 246 tests, type checking, transport audit and build.
Main now includes warm-instance roadworks/car park/fault caches, page-memory exact-photo vehicle
counts, and stronger speed-cache isolation/invalidation/CDN deadlines. Read `docs/caching.md` and
Turns 146–147 for TTLs, controls and release verification. No hosted shared cache is provisioned.
PR #23 still requires separate approval.

**Pagination PR #26 was explicitly approved and merged.** Final head
`ce495abfe32602745305ca18baaf3d50f0a2ef30` passed both CI runs with 264 tests and zero skips.
Main now includes opt-in bounded offset pagination, normalized-list revision checks, honest native
LTA windows and network-only paged requests in the service worker. Read `docs/pagination.md` and
Turns 148–149 for API shapes, preview/release checks and limits. Existing complete-list dashboards
remain compatible. Separate PR #23 still requires explicit approval.

**Weather-result cache PR #27 was explicitly approved and merged.** Final head
`8b72d868ffdd1cb12e70352ac0a8a705345aa98f` passed both CI runs with 275 tests and zero skips.
Main now reuses complete air (5 minutes), 24-hour outlook (15 minutes, validity-capped) and
lightning/heat (1 minute) results across full/paged reads. Three new server-only TTL settings
accept zero; defaults need no new credentials. Read `docs/weather-caching.md` and Turns 150–151
for invalidation, source-age/health behavior and release verification. No hosted cache is added.
Separate PR #23 still requires explicit approval.

Application login, account creation and brute-force lockout are **on hold at the
user's explicit request**. Do not resume them unless requested; see
`AUTHENTICATION_PLAN.md`.

**Public API rate limits are prepared in draft [PR #28](https://github.com/Mikazukiangus/live-traffic/pull/28)
on `codex/public-api-rate-limits`, pending review
and activation.** Read `docs/api-rate-limiting.md` and Turn 152. The user confirmed
Hobby, so the proposal uses one 300-per-60-second rule with OR groups for `/api/`
and SDK ID `trafficpulse-public-api-v1`; default application mode is off until setup.
Turn 153 resolved inspection through official Vercel CLI 65.2.0 after verifying
the exact existing project/team. There is no active custom Firewall configuration;
draft version 1 exists. The original rule matched only exact /api/ and had plain
Log with no rate limit. Corrected existing rule
rule_traffic_pulse_public_api_rate_limit_3e38zR through a targeted CLI draft update:
Path starts /api/ OR SDK ID, Fixed Window 300/60s, IP, Log on excess. Remote readback
confirms valid/no errors, one rule, only insert/update changes for the same rule,
unrelated settings unchanged and active still null at the end of Turn 153.
**Turn 154: the user published version 1 and CLI readback confirms it is active,
enabled and Log-only.** The rule-filtered hour returned no traffic events, so no
actual threshold/blocking behavior has been demonstrated. Staged the next targeted
update as draft version 2: Environment equals Preview ANDed into both OR groups,
excess `rate_limit` (Default 429), same 300/60s IP policy. Readback confirms valid,
one update for that rule only, active version 1 unchanged and unrelated settings
preserved. The user must review traffic/draft and publish version 2 for preview
testing; the agent has not published it. On Hobby, this preview-only single rule
temporarily excludes production from custom-rule logging; production is not throttled.
Automatic approval rejected replacing the entire unknown Firewall configuration;
do not retry that overwrite or work around the rejection. Continue from the existing
preview-only draft and user review/publication, then verify preview before approved
production blocking. Native WAF IP enforcement needs no app
redeploy or SDK mode change; SDK admission must remain off until its separate setup
works. Log-only publication is confirmed; blocking publication and production
enforcement are not confirmed. PR #28 remains unmerged.
Future verified-user bucket support is tested but has no identity provider while
login is on hold. A browser ID/header/provider key is not an authenticated user.
Implementation 8d1ac9e passed both CI runs with 287 tests, zero failures/skips,
type check/audit/build. Its Vercel preview is READY; selected homepage/invalid-input
checks passed, not active limit verification. Default off and setup blockers remain.
The separate pending PR #23 remains unmerged.

This note prepares a cloud development workspace. Production hosting is Vercel.
No new cloud workspace, hosting migration or secret transfer was performed when
writing it.

## Standing collaboration rules

- Update **CHAT_COMMENTS_AND_INSTRUCTIONS.md and its table of contents on every
  project turn**, including investigations, questions, confirmations and merges.
  Record outcomes and limitations, then commit and push before the final reply.
- Put runtime changes on a preview branch and make a reviewable PR. Obtain explicit
  approval before merging to main. A main push triggers Vercel production deployment.
  Documentation-only status updates have been committed directly to main.
- Use normal concise completion summaries. The old compulsory “This is completed”
  ending was revoked. Ask explicitly only when an actual decision/approval is needed.
- Never print, decrypt or commit credentials, `.env.local`, signing keys, cookies,
  bypass tokens or presigned camera URLs. Use fixed redacted diagnostics.
- Use **Bun 1.4.1** and committed `bun.lock`; do not create/commit package-lock.json.
  Keep existing unrelated work and local user data intact.
- Production uses Node 24. Preserve native Node fetch/Undici compatibility; do not
  switch server/tests to Bun's runtime or bypass the SSRF dispatcher casually.
- Do not invent live readings: show loading/unavailable/stale states honestly.
  Dispatch, booking and tow-fleet fixtures remain clearly labelled demos.

## Fresh workspace setup

If the platform already checked out the repository, use its project directory.
Otherwise, clone through the platform's authorized GitHub connection:

```sh
git clone --branch main https://github.com/Mikazukiangus/live-traffic.git
cd live-traffic
```

Inspect status/remotes before modifying an existing checkout. Provision Node 24
and Bun 1.4.1 using the cloud platform's supported runtime setup, then run:

```sh
node --version
bun --version
bun install --frozen-lockfile
if [ ! -e .env.local ]; then cp .env.example .env.local; fi
bun run lint
bun run security:audit
bun run test
bun run build
bun run dev -- --host 0.0.0.0 --port 3100
```

Use the platform's private forwarded preview for port **3100**. The production
preview command is `bun run preview` on port **4173** after building; it includes
the same local API middleware and deployed security headers. The API is not
available from a generic static file server alone. Keep secret-bearing development
previews private under the platform's access controls.

Do not disable CSP, TLS verification, DNS/IP checks or request validation to make
a cloud preview work. If its exact origin needs CORS access, configure that exact
origin in `API_CORS_ORIGINS` for this development workspace. Do not use `*`, a broad
Vercel wildcard or an arbitrary forwarded Host as trust. Investigate platform
network/proxy restrictions if provider access fails.

Tests use synthetic data and require no real LTA credential. Some tests bind an
ephemeral loopback HTTP server; arrange the platform's supported sandbox permission
if binding is restricted. Live-provider failures are distinct from test failures.

### Secrets and optional Python

The old Mac's `.env.local`, `.venv`, installed packages and connector sessions do
not transfer through Git. Add `LTA_ACCOUNT_KEY` using the cloud platform's approved
secret/environment interface if live LTA feeds are needed. Do not paste it into
chat or retrieve/decrypt hosted secrets as a setup shortcut. Production/Preview
had the key configured on Vercel; that does not inject it into a new workspace.
Without it, supported keyless camera/weather paths remain usable and LTA-only
feeds can report unavailable.

`config/schema.ts` is the validated source of truth; `.env.example` is complete
and generated with `bun run config:example`. `VITE_*` settings are public build-time
values. Never put secrets under that prefix. Shell/platform values take precedence
over Vite env files; restart dev after changing them.

Python is optional, used for helper scripts, not the web runtime. Recreate rather
than copy the old virtual environment if needed:

```sh
python3 -m venv .venv
source .venv/bin/activate
```

`scripts/build-basemap.py` uses the standard library. No requirements.txt or Python
app dependency manifest is currently tracked. Install a PDF helper such as pypdf
only if performing an ERP PDF update; app packages belong in Bun/node_modules.

## Product and architecture

- Vite 8, React 19, TypeScript and Tailwind 4 SPA; plain Vercel Node API handlers.
  There is **no application account/session system or database**. Saved commutes,
  history and preferences live in the user's browser and are not account-private
  or cloud-synced; do not automatically copy a real browser's storage.
- Default landing page: **Highway Cameras & EMAS**. Camera views and message signs
  have their own subtabs. The current app uses eight live LTA cameras; retired
  cameras/stock fallback images were removed. VMS shows all unique available
  messages, with location enrichment. Do not hardcode the number of signs.
- Radar uses LTA speed bands, traffic incidents and travel times plus NEA weather
  and other public hazard/road/car-park feeds. Checkpoint/certain unpublished
  travel times are estimates and must retain their labels.
- Vehicle counting runs locally in the browser through lazy ONNX/WASM downloads,
  not an external AI API. Keep bundler helper/worker splitting intact.
- ERP charging status is computed from the checked-in published rate table,
  currently effective **29 June 2026**, not a working live ERP-rates API. Recheck
  official schedules before calling rates current. An earlier local-app quarterly
  reminder is not a repository/cloud automation; its migration is unverified.

Responsibility map:

- `src/views/`: page composition; `src/features/`: focused hooks, components and
  resources for cameras, traffic, weather, commutes, radar, SOS and vehicle counting.
- `src/utils/feedResponse.ts` / `request.ts`: coalesced browser requests, safe
  HTTP/retry metadata and bounded response consumption.
- `api/`: public route adapters; `server/`: services, caches, provider transport,
  validation, CORS, health probes and SSRF/DNS enforcement.
- `shared/`: cross-runtime types, domain rules, validation, geography, time,
  diagnostics and the request-deadline primitive.
- `config/`: validated schema, separate browser/server projections and code policy.
- `vite.config.ts` / `server/apiMiddleware.ts`: local API routing. New endpoints
  require intentional local registration as well as deployed routes/contracts.
- `public/sw.js`: service-worker **build template**. Vite renders public numeric
  timeout policy via `server/serviceWorker.ts`; deploy normal build output, not a
  raw copy of that template.

## Latest release and verification baseline

[PR #18](https://github.com/Mikazukiangus/live-traffic/pull/18) added deadlines where
outbound calls lacked them:

- Browser APIs/cameras: **30 seconds**, cold speed aggregation: **90 seconds**,
  model/asset startup: **60 seconds**, including body consumption and cancellation.
- Service-worker API fallback: 80% of the browser deadline, preserving original
  cached observation age. Stalled image loads detach handlers/remove their source.
- Existing server/provider/tooling limits remain; the server transport now also
  supplies a default when no explicit signal is given.
- Read `docs/api/timeouts.md` for the inventory, settings and native browser-resource
  cancellation limits. Do not claim every browser-managed resource is abortable.

[PR #19](https://github.com/Mikazukiangus/live-traffic/pull/19) adds safe transient
read retries with exponential backoff/jitter, Retry-After minimums, cancellation and
shared deadlines. Ordinary LTA reads cap at 3 attempts, speeds at 4, camera/image
sources at 2 and paced weather at 2. Probes stay single-attempt. Permanent,
credential, schema, TLS and guard errors stop promptly; arbitrary mutations are
not replayed. The offline Overpass helper's known read-only POST query is an
explicit semantic exception. See `docs/api/retries.md` for exact budgets and limits.

[PR #20](https://github.com/Mikazukiangus/live-traffic/pull/20) adds finite,
independent circuit-breaker scopes around repeated provider reads. Five final
failures in 60 seconds pause a feed for 30 seconds, then one physical recovery
attempt is allowed. Retries count as one logical outcome. HTTP 429 retains its
separate cooldown; auth/permanent/security failures and caller abort stay neutral.
State is per warm function instance, not shared across replicas/regions/cold starts.
Health consults the same registry only in the same instance. Existing cache age,
public camera fallback and partial weather behavior remain honest. Open circuits
return safe 503/no-store/Retry-After. See `docs/api/circuit-breakers.md`.

[PR #21](https://github.com/Mikazukiangus/live-traffic/pull/21) adds a safe outer
Node/Web API exception boundary, root/per-tab React recovery, explicit notification
permission/delivery outcomes with bounded retries, complete air-quality feed state
and independent PSI/PM2.5 ages, plus one redacted event per failed partial source.
Alerts retry at most three times 15 seconds apart within two minutes and record
success only after browser acceptance (not proof of OS display). Partial feed
200/no-store contracts and original observation/receipt times remain intact.
See `docs/error-handling.md` for ownership and limits.

[PR #22](https://github.com/Mikazukiangus/live-traffic/pull/22) reserves pending work before feed/health notifications, isolates polling snapshots by URL, serializes worker cache compare-and-put per key, guards location/install event ownership, and patches current commute fields after permission/editor completion. See `docs/atomic-updates.md`. Guarantees remain per resource/repository/active worker; separate-tab localStorage edits and distributed function replicas are not transactionally coordinated.

[PR #24](https://github.com/Mikazukiangus/live-traffic/pull/24) adds a bounded page-lifetime queue for visitor-device vehicle analysis, optional commute-history receipts and notification attempts. Three independent lanes each have one physical slot. Defaults are 32 waiting jobs, a 1000-ms idle timeout and a 120000-ms lifetime, validated in config and `.env.example`. Only recomputable photo analysis opts into executor retries; existing notification policy retains its own limits. User saves/permissions and live API answers remain foreground. Closing the page discards pending jobs; no hosted/durable queue was added. See `docs/background-queue.md`.

[PR #25](https://github.com/Mikazukiangus/live-traffic/pull/25) adds bounded warm-instance roadworks (five minutes), car park/fault (one minute) caches and page-memory exact-photo vehicle counts (five minutes, 32 entries), plus account-isolated speed-cache invalidation and remaining-lifetime CDN headers. Original timestamps survive hits; partial/error results are not retained. No shared/durable cache service or new environment value is required. See `docs/caching.md`.

[PR #26](https://github.com/Mikazukiangus/live-traffic/pull/26) adds opt-in limit/offset pagination (100 default, 500 maximum) with named collections, scoped revision checks for normalized lists and honest unknown-total live windows for raw LTA. Paged requests are no-store/network-only; existing complete-list dashboard and offline behavior remain compatible. See `docs/pagination.md` for first/next requests, 409 restarts and all limitations.

[PR #27](https://github.com/Mikazukiangus/live-traffic/pull/27) adds complete normalized air-quality (5 minutes), 24-hour outlook (15 minutes capped by published validity) and lightning/heat-stress (1 minute) result reuse across full/paged reads. Each handler retains one result up to 512 KiB serialized JSON, preserves original observations, shrinks CDN lifetime and exports internal invalidation. Partial/error/incomplete results are not retained; health probes remain uncached. No hosted cache or credentials are required. See `docs/weather-caching.md`.

**275 tests**, type checking, security source audit and production build passed.
The Python wrapper ran four offline helper tests. Both final PR #27 checks and
Vercel checks passed. The weather-cache release verified HTTP 200 for the canonical homepage/entry bundle, paginated forecast (one of three periods) and air quality (two of five regions). These are selected deployed success paths, not measured cache hits, provider-wide health, browser performance or savings. The earlier pagination release verified the canonical homepage/entry bundle, rendered worker and two consecutive rain pages with the same revision (two of 47 areas per page), plus safe 409 revision-conflict and 400 invalid-limit responses. These are selected HTTP/artifact checks, not actual browser activation or a real upstream mutation. The earlier approved caching release verified HTTP 200 for the canonical production homepage, its actual entry bundle and referenced camera chunk, including the new model-contract cache revision. These establish deployed artifacts, not cache hit rate, inference output or production savings. PR #22's earlier release verified the rendered worker's version guard. Earlier error-handling checks covered the following providers; they were not repeated for this cache release. Production homepage/entry bundle, air quality (5 regions),
incidents (9 source records at the check) and rain (47 areas) returned HTTP 200 on
23 October. Interactive recovery-screen verification remains pending: the browser
approval reviewer hit its usage limit. An isolated synthetic fixture and manual
steps are documented; no alternate browser/protocol workaround or visual pass was
claimed. The user explicitly approved the merge after this limitation was disclosed.
The earlier timeout release also verified the worker's rendered 30000/90000/60000
policy and a local synthetic-image count with actual model/WASM/worker startup.
These are recorded checks, not a guarantee of current provider health in the new environment.

## Vercel and safe live checks

- Team: `carbon-bc04`, ID `team_ZEUyUqyAE43B7bGMi6Rdux14`.
- Project: `live-traffic`, ID `prj_OaQqagITm0LQjotv9EgoPZOWwjzT`.
- Canonical production: <https://live-traffic-carbon-bc04.vercel.app>.
- Other observed production alias: <https://live-traffic-kappa.vercel.app>.
  `live-traffic.vercel.app` belongs to a different application; do not use it.
- Last verified runtime deployment: `dpl_GgmHMJR46BbveXkWEGevKivg2DRJ`, READY for
  production merge `406fd7a`. Subsequent main documentation pushes can create newer deployments;
  verify current SHA/team/project/target rather than pinning that deployment forever.

Use the new chat's authenticated Vercel tools if available; connector authorization
may need reconnection in the new environment. Reuse these known IDs. A platform
401/403 can be deployment protection or team access, not an app/provider outage.
Use an authorized protected-fetch mechanism; do not disable protection or expose
a bypass token. One alias was externally protected and another reached public app
validation; no application login exists.

Avoid dumping `/api/trafficimages`: its DataMall response can contain presigned
credential-bearing image URLs. Prior automatic approval review rejected signed-URL
and camera-metadata probes through the protected-fetch connector. Do not bypass
that rejection with another transport. Use synthetic camera fixtures or an approved
credential-free image check; safe selected smoke paths include the homepage,
referenced entry bundle, `/sw.js` and keyless weather. Report blocked checks honestly.

## Read next and first cloud-chat action

Read `ARCHITECTURE.md`, `DEVELOPMENT.md`, `SECRETS_AND_LOGGING.md`, `docs/error-handling.md`,
`TRANSPORT_SECURITY.md`, and `docs/api/{circuit-breakers,retries,timeouts,ssrf,cors,request-validation,lta-traffic}.md`
as relevant. `COMMUTE_STORAGE.md` explains browser persistence; `WEATHER_FEEDS.md`
explains freshness and weather behavior. Older audit documents are dated snapshots;
use current code and later log entries when they differ.

First establish the cloud checkout/runtime, install the frozen dependencies, run
the baseline checks, and report setup status plus any actual secret/network/access
blocker. Record that turn in the project log and push it. Await the user's next
feature request; do not resume the held login project or provision a database.
