# Critical-path tests and coverage

Run these with Node 24.19 or newer in the Node 24 line, after installing the committed Bun lockfile:

```sh
bun install --frozen-lockfile
npm test
npm run test:coverage
npm run lint
npm run security:audit
npm run build
```

`npm test` includes both `.test.ts` and `.test.tsx` files. Coverage runs the same suite once and writes ignored local files `coverage/lcov.info` and `coverage/summary.json`. CI uploads both as the `critical-path-coverage` artifact, retained for seven days, including reports available from a failed test run. Test failures fail CI; no misleading global percentage gate is imposed.

## Critical paths exercised

- **Camera lifecycle and navigation:** actual React hooks/components in JSDOM verify refresh coalescing, last-good data during outages, offline flags, recovery, polling/listener cleanup, ignored late completion, deep links, keyboard typing exclusions, camera selection, the initial cameras page, clearing nested selections on page changes and history synchronization. Failed images are hidden and a replacement capture gets a fresh image element; delayed cards retain their label.
- **Account UI and safe recovery:** the real account client and menu sign in, change passwords and sign out against fake responses. Tests check request options, safe rendering of hostile account names, cooldowns, cancellation and late results. The actual React error boundary shows a safe message and matching diagnostic reference, allows one retry and resets on navigation.
- **Authentication over HTTP:** an actual loopback Node HTTP server routes through development middleware and the auth facade to Better Auth with an isolated SQLite database. Tests exercise wrong and correct passwords, secure HttpOnly cookies, session lookup, private/no-store responses, malformed and oversized bodies, sign-out and revoked cookies. Enrollment explicitly precedes sign-in because automatic sign-in is disabled. This is not a PostgreSQL test.
- **Database connection configuration:** constructing a PostgreSQL pool verifies TLS certificate checking, removal of URL SSL overrides, bounded options and idle-error redaction, with no connections opened.
- **Traffic decisions:** unit tests pin exact congestion/count boundaries, missing geometry, photo-to-count matching, live-speed precedence, zero counts, direction selection, graph merges, unknown routes, cycles and map layer selection. Missing data stays unknown.
- **Provider-to-response integration:** synthetic paged speed data flows through the actual fetch/aggregation/service/cache/endpoint/pagination layers. Tests verify reuse across pages, no incomplete dataset cached after a page-cap failure, and subsequent recovery. Camera URL resolution through the Web/Node binary proxy preserves signed bytes, image content and response policy without forwarding caller credentials.
- **Existing regression protection:** the original suite remains, including API input/provider validation, SSRF, CORS/HTTPS/cookies, rate admission, authentication, retries/timeouts/circuit breakers, cache/concurrency/pagination, background work and safe structured diagnostics.

Tests use synthetic keys, accounts, signed links, provider responses and isolated DOM/storage. They do not need real environment files, provider calls or a live database. Loopback HTTP fixtures require permission to bind a local port. Bun's installer may automatically load `.env.local`; the Node test commands do not load it.

## First expansion: PR #33 baseline and result — 29 October 2026

Before this change, **322 tests passed**. This change adds **22 test groups**, giving **344 passing tests**, with zero failures/skips. Type check, transport audit and production build also pass locally.

The report inventories TypeScript/TSX in `api`, `config`, `server`, `shared` and `src`. It excludes declaration files and five modules whose emitted JavaScript is empty. It parses source with esbuild without resolving imports or executing application code. Root `proxy.ts`, Vite configuration, scripts and public JavaScript such as the service worker are outside these reported percentages; separate regression assertions for those paths are not a quantified coverage claim.

Of **212 runtime source files**, tests previously loaded **141**, leaving **71 unmeasured**. They now load **151**, leaving **61 unmeasured**, including **44 TSX files**. Every unloaded file appears explicitly with `loaded=false` and `measured=null` in the JSON report. No executable-line denominator is invented for it.

For **loaded modules only**, line coverage changed from **92.98% to 93.36%**, branches from **91.31% to 90.75%**, and functions from **88.32% to 87.86%**. Branch/function percentages can fall when tests load previously absent UI and expose more untested paths. These are V8 measurements of transformed code, including module initialization/helpers; they are not whole-app coverage or proof that every path has a useful assertion.

Previously unloaded camera-feed hooks now measure 100% lines/branches/functions. Camera navigation measures 88.17% lines and 57.50% branches; account UI measures 100% lines and 80.65% branches. These numbers describe this run and do not establish browser-layout or end-to-end production correctness.

## Second expansion: weather, offline storage and browser scheduling — 29 October 2026

Seven additional tests bring the suite from **344 to 351 passing tests**, zero failures/skips. This change adds tests only; application runtime and dependencies are unchanged. Type check, transport audit and whitespace checks pass locally. CI runs the full suite and production build on the review branch.

New unit tests exercise rain classification/severity/nearest areas, partial corridor coverage and non-mutating descriptions; offline speed snapshot precision, exact expiry boundary, malformed storage and blocked/quota-failing storage. New JSDOM integration tests mount the real shared rain and weather-alert hooks through the actual fetch/validation/resource layers, covering request coalescing, partial observations, outage/offline retention without age renewal, recovery and subscription/timer cleanup. A browser-adapter integration test verifies idle deferral, urgent notification scheduling, cancellation of the idle callback, timer fallback, safe failure logs and disposal through the real queue.

Implementation `81bde8901afff1762081535316a7bed021dc5856` is published in [merged PR #34](https://github.com/Mikazukiangus/live-traffic/pull/34). [CI run 40815158352](https://github.com/Mikazukiangus/live-traffic/actions/runs/40815158352) passed all 351 tests, type check, transport audit and build. Its coverage agrees with the local figures below; the [coverage artifact](https://github.com/Mikazukiangus/live-traffic/actions/runs/40815158352/artifacts/12871619456) has seven-day retention. [Preview](https://live-traffic-5lyyo7fti-carbon-bc04.vercel.app) is READY for that SHA. The user approved the merge on 29 October 2026; main merge commit is `33ad5f2b7d53d037251c32b7d5dffa32311221a6`. Its [main Checks run](https://github.com/Mikazukiangus/live-traffic/actions/runs/40815492581) passed all 351 tests, type check, transport audit, coverage upload and build. Production deployment `dpl_31LMmVcHPMJU4SHdbcnDAGAsJhkQ` is READY for that merge SHA, the canonical alias resolves to it, and the authenticated homepage returned HTTP 200. No manual promotion was used. Application code/dependencies are unchanged.

The measured runtime inventory stays **151/212 loaded**, with **61 files unmeasured**. These tests exercise previously loaded but largely uncalled modules; they do not remove the unmeasured UI gap. Loaded-module line coverage rises **93.36% → 94.22%**, branches **90.75% → 90.80%**, functions **87.86% → 89.51%**, in the local run. Per-run V8/transpiler and asynchronous-branch caveats above still apply.

| Module | Previous line coverage | Current line coverage | Current branch coverage |
| --- | ---: | ---: | ---: |
| Browser background adapter | 47.83% | 100% | 86.67% |
| Rain decisions/compatibility hook | 63.44% | 100% | 96.97% |
| Shared rain-feed hook | 65.22% | 100% | 100% |
| Offline speed snapshot | 67.57% | 100% | 90% |
| Weather-alert hook/helpers | 68.63% | 96.08% | 100% |

Tests use synthetic responses and isolated DOM/storage/timers. No real provider, account, database, model inference, location/notification permission or environment file is used. Browser-adapter scheduling tests are not proof of real-browser rendering performance or OS notification delivery.

## Weakest coverage and next work

1. **Actual vehicle inference:** `src/features/vehicle-counting/engine.ts` measures 51.16% lines but only 1/7 functions. Its 100% reported branches cover just two module-level branches, not the inference algorithm. Add fixed-image tests with expected boxes/counts through the actual ONNX/WASM runtime, plus decoder/NMS assertions and browser memory/cancellation checks. Queue/cache tests cannot establish model accuracy.
2. **Full application/browser flows:** `src/App.tsx`, the four page views and many components are never loaded. Add real-browser tests for initial cameras, checkpoint/tab selection, refresh during failure/recovery, back/forward, account dialogs, mobile keyboard/focus and service-worker install/update/offline behavior. JSDOM verifies semantic DOM/hooks, not responsive layout, image decoding, OS notifications, permissions or wake locks.
3. **Live PostgreSQL behavior:** auth service tests use SQLite; pool configuration tests open no connection. Use a disposable test database to cover PostgreSQL migrations, session revocation, atomic per-user counters under concurrency, connection failure/recovery and multi-instance behavior. Keep credentials outside logs/reports and separate from production.
4. **Remaining hook, selector and UI branches:** `src/features/radar/radarSelectors.ts` measures 59.52% lines, `src/features/vehicle-counting/useVehicleCounts.ts` 65.79% and `src/components/WeatherOutlook24h.tsx` 69.11%. Add selection/missing-source branches, visible-camera lifecycle/cancellation and actual 24-hour weather rendering scenarios. The second expansion improved rain hooks, offline snapshots and the browser queue adapter; their high line coverage still does not cover every branch or prove browser performance. Choose scoped coverage gates only after agreeing on meaningful behavior scenarios.
5. **Live upstream contracts:** fixtures validate known shapes, not current LTA/NEA/PUB availability, signed-photo expiration or deployment access. Keep bounded deployment smoke checks separate from deterministic unit/integration tests.

Use `coverage/summary.json` for the complete measured and never-loaded file lists. Prioritize behavior and risk; avoid raising a global percentage by importing files without exercising them.

## Review and CI evidence

Implementation commit `104a203659f70c2301f69937b8354250c88bf95f` is in [merged PR #33](https://github.com/Mikazukiangus/live-traffic/pull/33). Both Checks runs [40785323376](https://github.com/Mikazukiangus/live-traffic/actions/runs/40785323376) and [40785347574](https://github.com/Mikazukiangus/live-traffic/actions/runs/40785347574) passed. The [coverage artifact](https://github.com/Mikazukiangus/live-traffic/actions/runs/40785323376/artifacts/12857709464) contains both reports and expires after seven days. CI branch coverage was 90.73%/90.68%, slightly different from the local run because asynchronous execution can change instrumented branches; line coverage, file inventory and function percentage agree. Read each artifact as evidence for its own run.

The [Preview](https://live-traffic-itzr6bd8o-carbon-bc04.vercel.app) is READY for that implementation commit. This establishes build readiness, not live provider/database/browser correctness. PR #33 was explicitly approved and merged as `93078e80bd490cf30583504e3068c26c7f18565c`. Its main [CI run](https://github.com/Mikazukiangus/live-traffic/actions/runs/40789246625) passed all 344 tests, type check, transport audit and build. The production deployment is READY and the canonical domain resolves to that merge. Application runtime is unchanged; live browser/model/database limits above still apply.
