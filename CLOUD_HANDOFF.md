# TrafficPulse — cloud workspace handoff

Prepared 22 October 2026; release status refreshed 23 October 2026 (Asia/Singapore). Repository:
<https://github.com/Mikazukiangus/live-traffic>.

## Start here

Continue development from the **latest `main`**. Read this note, the standing
instructions at the top of `CHAT_COMMENTS_AND_INSTRUCTIONS.md`, and its latest
turns before working. Also follow the new workspace's platform/AGENTS instructions.

Snapshot before this handoff: main `121496926c6376d94ee0b04619db5ad672e6c201`.
Fetch current main to include this handoff and its log entry; do not reset to that
older snapshot. The local checkout had no tracked changes and only a pre-existing
untracked `.claude/` directory. No local-only implementation needs recovering.

**The latest implementation is complete.** PR #19 (safe provider retries) is merged as
`3a16828ebcd88d7d99f4644338978f7ad0e4b140`, following PR #18's timeout release.
No implementation from this session
is waiting to be merged.
Application login, account creation and brute-force lockout are **on hold at the
user's explicit request**. Do not resume them unless requested; see
`AUTHENTICATION_PLAN.md`.

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

**173 tests**, type checking, security source audit and production build passed.
The Python wrapper ran four offline helper tests. Both final PR #19 checks and
Vercel checks passed. Production homepage/entry bundle, incidents (22 source
records at the check) and rain (47 areas) returned HTTP 200 on 23 October.
The earlier timeout release also verified the worker's rendered 30000/90000/60000
policy and a local synthetic-image count with actual model/WASM/worker startup.
These are recorded checks, not a guarantee of current provider health in the new environment.

## Vercel and safe live checks

- Team: `carbon-bc04`, ID `team_ZEUyUqyAE43B7bGMi6Rdux14`.
- Project: `live-traffic`, ID `prj_OaQqagITm0LQjotv9EgoPZOWwjzT`.
- Canonical production: <https://live-traffic-carbon-bc04.vercel.app>.
- Other observed production alias: <https://live-traffic-kappa.vercel.app>.
  `live-traffic.vercel.app` belongs to a different application; do not use it.
- Last verified runtime deployment: `dpl_Bir2cTBcmPvGacpGJR1CvgbpR3yx`, READY for
  merge `3a16828`. Subsequent main documentation pushes can create newer deployments;
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

Read `ARCHITECTURE.md`, `DEVELOPMENT.md`, `SECRETS_AND_LOGGING.md`,
`TRANSPORT_SECURITY.md`, and `docs/api/{timeouts,ssrf,cors,request-validation,lta-traffic}.md`
as relevant. `COMMUTE_STORAGE.md` explains browser persistence; `WEATHER_FEEDS.md`
explains freshness and weather behavior. Older audit documents are dated snapshots;
use current code and later log entries when they differ.

First establish the cloud checkout/runtime, install the frozen dependencies, run
the baseline checks, and report setup status plus any actual secret/network/access
blocker. Record that turn in the project log and push it. Await the user's next
feature request; do not resume the held login project or provision a database.
