# N+1 and repeated-work review

Reviewed 21 October 2026 against main at `a8005232edbe78b9bf68d00d47607969f66c1c45`.

**Released (21 October 2026):** [PR #11](https://github.com/Mikazukiangus/live-traffic/pull/11) merged into main as `671e6d0` after explicit approval. Shared travel-time/air-quality resources and batched/no-op history recording are live in production. This review's pinned evidence and original counts describe the baseline. Optional hidden-camera inference deferral remains a separate improvement.

## Conclusion

TrafficPulse has no SQL/ORM query path, so there is no confirmed database N+1 query to eager-load or index. Commute cards already receive the complete travel-time dataset through props. Camera metadata also arrives as a collection. Mapping those records does not issue one query per item.

The baseline has two confirmed repeated-work opportunities: completed feed results are lost across some page remounts, and each commute card independently rewrites the whole history store. The released implementation addresses both; the evidence below records why the changes were recommended.

| Priority | Location | Repeated work | Recommended change |
|---|---|---|---|
| First | Travel-time and air-quality hooks | A new page mount starts another request even after a recent completed request | Retain a validated shared feed snapshot and reuse it until due for refresh |
| Second | Commute history recording | Up to three whole-history writes/publications for one feed update; unchanged samples still write | Skip unchanged writes, then record eligible samples in one repository batch |
| Optional | Camera/sign subtabs | Hidden camera content continues optional work while road signs are selected | Defer image analysis when it is not needed, preserving quick subtab switches |

These are source-based opportunities, not a production latency ranking. Browser/CDN caches and server caches can prevent a browser request from becoming another provider request.

## 1. Reuse completed feed results across page mounts

### Evidence

- [`usePolledJson.ts:26`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/utils/usePolledJson.ts#L26) owns state per hook instance and starts a load on mount at line 62.
- [`feedResponse.ts:20`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/utils/feedResponse.ts#L20) shares pending requests by URL, but removes the entry when the request finishes at line 33. It is not a completed-response cache.
- [`HighwayCamerasView.tsx:62`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/views/HighwayCamerasView.tsx#L62) and [`useRadarSources.ts:31`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/radar/useRadarSources.ts#L31) acquire travel times; both also acquire air quality.
- [`App.tsx:169`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/App.tsx#L169) mounts main pages conditionally. Cameras and radar do **not** currently poll concurrently as two mounted pages. Switching pages unmounts the old hooks; the next mount reacquires these feeds.

An isolated fetch stub confirmed:

| Synthetic sequence | Total HTTP calls to the stub |
|---|---:|
| Two overlapping consumers of one URL | 1 |
| Another consumer after that request completes | 2 |

### Proposed shape

Keep the existing domain adapter, but subscribe it to a shared resource rather than creating a new polling owner on every mount:

```ts
// CURRENT: new state and polling lifecycle for each mounted hook instance.
const feed = usePolledJson('/api/traveltimes', pollMs, validate);

// IMPLEMENTED: travelFeed is a module-owned browser resource.
// Its validated snapshot survives gaps between subscriptions.
const feed = useSharedFeed(travelFeed);
const byCode = useMemo(() => sumTravelTimes(feed.data?.value ?? []), [feed.data]);
const routes = useMemo(() => groupStretches(feed.data?.value ?? []), [feed.data]);
```

Apply the same ownership pattern to air quality. Use the existing [`speedResource.ts:166`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/traffic/speedResource.ts#L166) and [`rainResource.ts:77`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/weather/rainResource.ts#L77) as working examples:

1. Keep one snapshot, pending request and refresh deadline per feed.
2. Subscribe on mount; reuse a recent snapshot immediately and refresh only when due.
3. Share refresh calls and one timer while subscribers exist; remove timers/listeners when the last subscriber leaves.
4. Retain source/receipt timestamps, validation, error/offline status and retry cooldowns. Reading cached data must not renew its age or turn stale data into a live success.

Acquire the complete dataset once and derive all corridor/commute readings from it. This is the HTTP equivalent of eager-loading related data. Do not move every optional page feed into App merely to keep it mounted.

Verification for an implementation: a camera-to-radar switch within the refresh interval should retain the reading without another fetch; switching after expiry should refresh once; concurrent refresh calls should share one request; failed/offline responses must preserve honest age/status.

## 2. Batch commute-history writes

### Evidence

[`MyCommute.tsx:18`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/commutes/MyCommute.tsx#L18) renders one card per commute. Each card calls [`useCommuteHistory.ts:18`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/commutes/useCommuteHistory.ts#L18), whose effect records a sample. [`commuteRepository.ts:134`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/commutes/commuteRepository.ts#L134) rewrites the entire history envelope and publishes even if sample pacing suppressed the new sample.

An injected in-memory repository with three valid commutes confirmed:

| Synthetic update | Whole-history writes | Publications | Samples per commute afterward |
|---|---:|---:|---|
| First live receipt | 3 | 3 | 1 each |
| Same totals two minutes later | 3 | 3 | Still 1 each |

This is bounded write amplification in browser localStorage, not SQL N+1. The app allows at most three commutes, so the impact is modest.

### Proposed shape

First avoid persistence/publication when neither samples nor pruning changed history. Then move recording to the commute-list controller and keep cards as subscribed readers:

```ts
// CURRENT, inside every card's effect:
recordSample(id, routeKey, total, travelFetchedAt);

// IMPLEMENTED: one controller effect calls the repository batch command.
// summaries are derived once from the same feed snapshot for all commutes.
useEffect(() => {
  if (travelStatus !== 'live' || travelFetchedAt == null) return;
  const rows = summaries.flatMap(({ commute, total, anyEstimated }) =>
    total == null || anyEstimated ? [] : [{
      id: commute.id,
      routeKey: commuteRouteKey(commute),
      minutes: total,
      receivedAt: travelFetchedAt,
    }],
  );
  repository.recordBatch(rows);
}, [repository, summaries, travelStatus, travelFetchedAt]);
```

The controller should memoize its summaries from actual route/feed inputs. Remove the old per-card recording effects so both paths do not run. Keep card subscriptions for sample/trend display.

`recordBatch(rows)` must validate every row against the current saved route and its persisted revision, apply existing sample spacing and three-hour retention, compare the resulting history, and persist/publish once if changed. It must retain protected-store behavior, write-failure notices and the partial-write safeguards in [COMMUTE_STORAGE.md](COMMUTE_STORAGE.md). Do not implement batching by bypassing repository validation or delaying durability indefinitely.

Target counts for an implementation: three new samples produce one history write/publication; an unchanged update with no expiry produces zero. Stale-route, estimated, malformed and out-of-order samples must retain their current rejection/spacing behavior.

## 3. Optional work in hidden camera subtabs

[`HighwayCamerasView.tsx:276`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/views/HighwayCamerasView.tsx#L276) deliberately retains hidden camera/sign subtab content for quick switching. Camera counts are queued independently of whether the signs tab is selected. This differs from main-page mounting.

A later optimization could retain metadata/images while deferring optional image analysis until camera content is needed, then resume the selected camera first. Preserve the requested instant navigation. Establish any bandwidth savings with a browser trace before claiming them: repeated image elements can share browser/CDN cache entries.

The [`vehicle-counting/engine.ts:29`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/src/features/vehicle-counting/engine.ts#L29) already shares its lazy runtime/model. Its 24-tile loop performs local inference, not 24 image downloads. Distinct camera frames still require distinct images; no verified upstream batch-image endpoint is available to substitute.

## Existing batching to preserve

- **Speed data:** [`speedService.ts:14`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/server/traffic/speedService.ts#L14) fetches bounded page waves, aggregates all roads once and shares pending/cached results. These are pages of a bulk collection, not queries per expressway.
- **Other LTA collections:** [`lta.ts:148`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/server/providers/lta.ts#L148) already paginates in bounded waves. Increasing concurrency can reintroduce upstream failures.
- **Floods:** [`_floods.ts:86`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/api/_floods.ts#L86) follows continuation tokens within bounded lookback/page limits. A later token is unknown until the previous response arrives; retain that dependency.
- **Independent weather sources:** air-quality, road-condition and weather-alert handlers already acquire independent datasets concurrently. Preserve data.gov.sg pacing and cooldowns.
- **Health:** [`health.ts:55`](https://github.com/Mikazukiangus/live-traffic/blob/a8005232edbe78b9bf68d00d47607969f66c1c45/api/health.ts#L55) intentionally probes a fixed provider catalogue. This is diagnostic fan-out, not a request per returned row. Footer/modal checks share pending work; any future short-lived report reuse must display its age and preserve an explicit measured refresh.

`Promise.all(items.map(fetchOne))` still makes one request per item. It overlaps waiting; it does not batch request count. True batching here means one collection acquisition shared by consumers, or one validated repository commit for several samples.

## Scope and next step

The first two recommendations are released on main. Verification confirmed recent remounts reuse the original completed snapshot and deadline; concurrent refresh calls coalesce; failures/offline replies retain honest timestamps/status; cooldowns and disposal remain safe. Batched recording changes three history writes/publications to one, with zero on an unchanged update absent expiry/failure retry. Existing route-revision, protected-store and partial-write safeguards remain covered. Optional image-work deferral and diagnostic-report reuse are not included.

Baseline evidence consists of source inspection and isolated fetch/repository stubs. Preview verification adds deterministic regression tests and a loopback fixture using the actual hooks/commute cards under React Strict Mode, with synthetic responses/storage. Browser checks confirmed no added feed requests on recent page switches, one write for three cards, no unchanged-update write, immediate route-history clearing on failed feeds and no history for estimated routes. These are not production latency measurements. No live providers, SQL database, real saved user data or signed image URLs were used. Final suite/build and publication results are recorded in CHAT_COMMENTS_AND_INSTRUCTIONS.md.
