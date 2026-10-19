# Configuration audit

## Findings and changes

| Finding | Resolution |
| --- | --- |
| Template advertised unused Gemini/AI Studio settings | Removed `GEMINI_API_KEY` and `APP_URL`; generated the example from the real schema. |
| Provider URLs were copied across handlers and health probes | Derive every LTA/NEA/PUB path from validated provider bases; share the keyless camera fallback. |
| Camera handler read the primary key differently from other handlers | Use the same validated primary/legacy key resolver and existing request-header fallback. |
| Polling, freshness, request limits and caches were scattered | Central config contains named polling/freshness/cache profiles and bounded operational overrides. |
| Some upstream calls had no timeout | Apply the shared request timeout to LTA proxy, cameras and image proxy. |
| Local API imports could run before env loading | Import handlers lazily after Vite loads and validates local files. |
| Local port and social metadata were tied to one machine/deployment | Validate dev host/ports and use the configured site origin in built social metadata. |
| CI health URL/retry timings and offline map provider were embedded separately | Read explicit non-secret subsets of the same config in the workflow and Python helper. |
| Environment configuration could cross into browser code accidentally | Separate entry points; browser projection omits server settings; Vite fails a server-config browser import. |
| Making page caps configurable could produce convincing but incomplete data | Bound concurrency and refuse a partial dataset when the cap is exhausted. |

## Configuration contract

`config/schema.ts` is the canonical definition and validator. `createConfig(env)`
returns one deeply frozen object containing public settings plus server, local
server, helper-tool and automation sections. The browser uses
`createPublicConfig(import.meta.env)` through `config/client.ts`, which validates
and returns only public settings. `config/server.ts` reads process environment
once per process. Restart after environment changes.

The committed `.env.example` lists every schema setting, its scope, meaning and
default. `bun run config:example` regenerates it. Regression tests compare the
committed template with the generator to catch drift. Platform-owned `NODE_ENV`, Vercel-injected public metadata
and the GitHub-only automation bypass secret are documented separately. Explicit
platform metadata names are accepted without treating arbitrary `VITE_VERCEL_*`
variables as safe.

Malformed settings fail before serving/building. URLs require HTTPS, with HTTP
allowed only for loopback fixture servers. URL credentials, query strings and
fragments are rejected; operational URLs are never printed in validation errors.
Server-secret placeholders are rejected; empty keys intentionally preserve the
existing keyless camera/weather mode. The browser cannot import or serialize the
server key through its supported config entry point.

## Values deliberately kept in code

| Category | Reason |
| --- | --- |
| Image proxy host allowlist (`config/policy.ts`) | Security boundary reviewed in code; arbitrary env host lists could turn it into an open proxy. |
| Feed paths, page size 500, response shapes, statuses | Provider protocol contracts; bases are configurable. |
| Camera IDs/names, Singapore bounds/timezone, road mappings and speed-band meanings | Domain data and interpretation, independent of deployment. |
| ERP source PDF, effective date, rate schedule and holiday calendar | Versioned official source data. Editing an env URL cannot update the transcribed rates. |
| Model path, 416px input size, detection thresholds | Coupled model implementation/calibration, rather than interchangeable deployment settings. Counting has an env enable/disable flag. |
| UI animation timers, demo fleet data, notification text, storage/cache schema keys | Presentation/demo behavior and data compatibility. |
| Attribution, Google Fonts/Maps links, illustrative background assets | Product content/assets; not credentials or deployment destinations. |
| Service worker routes/cache versions, GitHub cron/runtime/install versions | Platform lifecycle and reproducibility policies. The health target and HTTP/retry timings are configurable. |
| Python generator frame, map geometry and data selection | Domain/build algorithm; its provider, timeout and retry policy are configurable. |

Existing `.env.local` and `.venv/` remain ignored. No credentials were copied,
changed or committed. Current Vercel environment values are not changed by this
refactor; defaults keep the existing deployed behavior.
