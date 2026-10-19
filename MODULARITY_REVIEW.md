# Modularity review

Reviewed 19 October 2026 against `29820e5` on `main`. This is a source-level architecture review and proposed refactoring plan. Application behavior has not changed. Line references describe that baseline; file length alone is not a reason to split a module.

The largest opportunity is to separate data ownership, traffic calculations, navigation and rendering. The project already has useful boundaries: server/client config projections, safe diagnostics, the development API adapter, feed-response handling and several focused domain helpers.

## Priority 1: Give speed data and traffic rules clear ownership

Relevant locations:

- `src/views/LiveRadarView.tsx:151–223`: its own speed state, polling, parsing and saved-snapshot fallback.
- `src/views/HighwayCamerasView.tsx:201–229`: another speed fetch/throttle/fallback implementation.
- `src/utils/expresswaySpeeds.ts:19`: a third, summary-only hook, used by `App.tsx:144`.
- `src/components/LiveVmsBoards.tsx:144–164`: a fourth loader that retries until geometry is available.
- `src/utils/feedResponse.ts:5`: shares simultaneous requests for an identical URL, but does not share subscriptions, completed results or refresh schedules. VMS uses raw fetch, and the summary URL differs from the segments URL.

**Why this matters:** freshness, validation and fallback behavior can diverge between screens. An extracted hook instantiated in several places would still create several independent pollers; moving code into a hook alone does not establish shared ownership.

**Proposed split:** create a typed speed-feed resource in `src/features/traffic/` with a hook exposing its snapshot. It should own validation, in-flight requests, refresh timing, retained data, source timestamps and offline/error state. Keep snapshot persistence in a separate adapter. Explicitly support summary-only consumers versus those needing geometry, so opening an unrelated page does not force a segments download. VMS can consume retained geometry without becoming another speed poller. The existing `useApiHealth` shared-store pattern is a useful local precedent; a new state library is not necessary for this change.

Move `SpeedSegment`, `ExpresswaySpeedSummary` and `CheckpointApproach` into a browser-safe `shared/traffic/types.ts`. `SpeedSegment` is currently independently declared in the API and `SpeedBandMap.tsx`, with utilities importing the latter through type-only imports. Those imports do not themselves load map code at runtime, but ownership belongs with the data contract.

Move the duplicated band-to-speed values and checkpoint booth zones into `shared/traffic/rules.ts`. The two current booth-zone implementations explicitly say “keep in sync.” Preserve distinct algorithms: corridor arithmetic averages, nearby directional harmonic means and traced-route estimates serve different purposes. Share their constants without collapsing their semantics.

## Priority 2: Split the two page controllers

### `src/views/LiveRadarView.tsx` — 1,311 lines

This file owns four tabs, feed coordination, local storage, URL state, keyboard/wall navigation, proximity calculations, map-marker construction, freshness messages and rendering.

| Current responsibility | Proposed owner |
|---|---|
| Tab/road URL state, saved tab, shortcuts and wall cycling (122–142, 235–251) | `useRadarNavigation.ts` |
| Proximity, corridor summaries, map markers and freshness derivation (254–358) | Pure functions in `radarSelectors.ts`; a small hook for layer preference persistence |
| Corridor cards and selected map (585–879) | `ExpresswaysPanel.tsx`, with `CorridorCard.tsx` and `SelectedCorridorMap.tsx` |
| Air, rain, flood, lightning and heat UI (881–1081) | `WeatherPanel.tsx` |
| Incident filtering, focus and road conditions (1083–1304) | `IncidentsPanel.tsx` |
| ERP tab (1306 onward) | Keep composing the existing `ErpRatesTable` and `CarParkAvailability` |

Leave the view responsible for composing panels and coordinating cross-tab actions. Keep data subscriptions above panels that share them. Panels should receive named domain data and actions, rather than every state setter from the old view. Preserve the existing mounted-but-hidden tab behavior during the initial extraction.

### `src/views/HighwayCamerasView.tsx` — 928 lines

The file combines provider fallback, normalization, polling, traffic/model interpretation, camera navigation, dialog focus, weather enrichment and three image presentations.

| Current responsibility | Proposed owner |
|---|---|
| Internal API/direct public fallback and refresh lifecycle (231–312) | `useCameraFeed.ts`, backed by a camera client |
| Raw camera records → named camera data (269–291) | Pure `normalizeCameraFeed.ts` |
| Count calibration, nearby-speed precedence, checkpoint approach selection (35–48, 339–373 and checkpoint summary construction) | Pure `cameraReadings.ts` |
| URL/history, saved tab, Near Me precedence, arrows/swipes (167–199, 375–446) | `useCameraNavigation.ts` |
| Grid, checkpoint summary and enlarged image | `CameraGrid.tsx`, `CheckpointSummary.tsx`, `CameraDialog.tsx` |
| Proxy URL, image failure state, capture age and common image display | A shared camera image component/helper within this feature |

The dialog should own its focus and modal lifecycle; navigation owns whether it is open and which camera is selected. Grid and dialog should consume the same derived camera reading, preserving the rule that a vehicle count belongs to one exact image URL. Keep feed state outside the tab presentation so switching tabs retains loaded data.

## Priority 3: Separate backend transport from calculation

### `api/expresswayspeeds.ts` — 327 lines

There are four independent responsibilities: route tracing (52–171), paged fetching/retries (179–201 and 219–228), aggregation (230–277), and cache/HTTP response handling (173 and 280–327).

Proposed modules:

- `server/providers/ltaSpeedPages.ts`: paged provider acquisition, bounded concurrency, retries and page metadata.
- `server/traffic/aggregateSpeeds.ts`: pure incremental accumulation/finalization of summaries and map segments.
- `server/traffic/traceCheckpoint.ts`: pure route tracing and approach estimates; route definitions can stay beside it initially.
- `server/traffic/speedService.ts`: cache lifetime and orchestration.
- Existing `api/expresswayspeeds.ts`: thin HTTP entry point preserving query parameters, CORS, headers and response/error contracts.

Do not replace the specialized fetcher with `fetchLtaAll` unchanged: the speed path retains page timestamps and has different retry behavior. A common page primitive should expose those requirements explicitly. Keep helpers under `server/` rather than adding public API entry points.

### `api/_client.ts` — 230 lines

Its name suggests an LTA client, but it also owns generic HTTP responses/CORS/cache headers and the keyless data.gov.sg v2 client.

Split into `server/http/responses.ts`, `server/providers/lta.ts`, and `server/providers/dataGov.ts`. Keep safe failure projection in the existing `shared/diagnostics.ts`. Migrate callers incrementally, with temporary compatibility exports if useful. Preserve both Node-style and Web Response paths; the existing diagnostics tests already exercise that boundary.

## Priority 4: Isolate application workflows

### `src/App.tsx` — 410 lines

`App` reasonably composes pages, but also implements URL/search/home navigation, wall-display controls, pickup-derived readings, modal state and a fabricated dispatch assignment (203–225).

Extract `useAppNavigation`, `WallDisplayControls`, and a `useDemoDispatch` reducer/controller. Move the assignment fixture into a clearly named demo-data module. Group pickup calculations in `usePickupReadings`; group related SOS modal rendering under `SosOverlays` if that reduces cross-feature props. Preserve dispatch state across page changes by keeping its owner at app scope. Keep the lazy page imports and actual composition in `App`.

### `src/components/MyCommute.tsx` — 454 lines

This already contains natural boundaries: list controller (52), card (77), sparkline (261), editor (279) and leg editor (377). Extract those into `src/features/commutes/`.

More valuable than moving JSX: move totals, estimated-time flags, weather severity and incident/flood aggregation (92–110) into a pure `summarizeCommute` function; move recording/trend effects (113–120) into `useCommuteHistory`. The card then consumes one summary. Preserve the rule that only live, non-estimated travel times enter history.

## Smaller follow-ups

- **`LiveVmsBoards.tsx` (264 lines):** extract message classification/grouping and location enrichment into pure `vmsBoards.ts`, then separate board/location rendering. The shared geometry owner above removes its bespoke loader. Keep the current matching and grouping semantics during extraction.
- **`vehicleDetection.ts` (220 lines):** separate the React queue/visibility lifecycle (171 onward) from the browser inference engine (33–157). Keep lazy ONNX loading, one runtime/session and existing worker settings. Pure output decoding/suppression can be extracted if needed for focused tests; no need to fragment each small helper immediately.
- **`api/health.ts` (276 lines):** separate probe execution/combination from the endpoint catalogue. Share a static, env-free endpoint identity catalogue with `scripts/health-report.ts`, which currently repeats all 15 paths. CI must continue using trusted static labels and validating unknown/duplicate records; do not replace that with server-supplied labels. Keep authenticated probe configuration server-only.
- **`src/data/mockData.ts` (427 lines):** separate real expressway reference data from demo pickup/tow/workshop/sign data and emergency contacts. Incident parsing and road search currently import real corridor names from a module named `mockData`. This is primarily a clarity/ownership problem, not proof that all demo data reaches every bundle.

## Boundaries to preserve

- Keep `config/schema.ts` cohesive: validation, projections and generated `.env.example` form one source of truth. Do not create separate competing schemas while reorganizing features.
- Keep `shared/diagnostics.ts`, `server/apiMiddleware.ts`, `feedResponse.ts` and the focused ERP helpers as reusable boundaries.
- Shared domain modules must not import React, DOM APIs, provider credentials or server config. UI depends on hooks/domain rules; server entry points depend on services/domain rules.
- Prefer feature folders for new extractions over adding more unrelated exports to `src/utils`. Avoid a repository-wide move-only rewrite or a single giant replacement hook.
- Existing state is small enough that this work does not require a state-management dependency or a new application framework.

## Suggested delivery sequence and verification

1. Extract shared traffic contracts/constants and backend pure calculations. Add fixture tests for route tracing, incomplete speed coverage and booth exclusion, preserving existing outputs.
2. Establish the shared browser speed resource and migrate consumers. Test summary/geometry demand, overlapping refreshes, stale/offline snapshots and disposal. The current `fetchFeed` test covers simultaneous same-URL requests, not shared polling ownership.
3. Extract the camera feed/readings and UI. Check fallback, current-image counts, stale labels, direct links, Back, Escape, focus restoration and swipes on mobile and desktop.
4. Extract radar panels/navigation, then commute and app workflows. Check shared tab URLs, refresh, wall cycling, incident focus and retained state across tabs/pages.
5. Tidy provider clients, health metadata, VMS and demo/reference data as focused follow-ups.

Each implementation should be a reviewable preview change with unchanged API/UI behavior, passing the relevant tests, type check and production build, followed by explicit approval to merge. Existing tests cover diagnostics, parsers, configuration and several live-data edge cases; the current suite has no direct `traceCheckpoint` or VMS-grouping tests. Add these focused checks when extracting those responsibilities.

This review used source and test inspection. No runtime tests or live provider calls were needed for the documentation-only change, and no new runtime bugs are claimed as reproduced here.
