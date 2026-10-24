# List endpoint pagination

Developed from main `1dfe769` on `codex/list-pagination`, 24 October 2026. Runtime changes require preview review and explicit approval before merging. Pending PR #23 remains separate.

## Choice: offset with live-snapshot checking

This app serves bounded provider snapshots and derived arrays. It has no database, immutable event sequence or indexed `(created_at, id)` ordering to seek through. LTA publishes offset windows through `$skip`, capped at 500 records per request: see its official [API User Guide, page 9](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf).

| Use case | Choice and reason |
| --- | --- |
| Current app lists: car parks, roadworks, cameras, weather, summaries | Offset into the normalized list, with a content/order revision checked on subsequent pages. Straightforward page navigation and totals without inventing database cursor semantics. |
| Raw LTA incidents, VMS, travel times and speed bands | Offset mapped directly to provider `$skip`. One provider window per call; total and snapshot are explicitly unknown. |
| Future stored history/event timeline | An indexed keyset cursor could be appropriate after defining durable unique ordering and persistence. Encoding today's array index in base64 would not supply that guarantee. |

Pagination is opt-in to preserve existing app contracts. Adding any supported paging parameter activates it. Without paging parameters, dashboard/map polling still receives its complete normalized snapshot or existing native LTA window. In particular, a truncated list must not become a falsely low incident count, incomplete nearest-car-park search or incomplete map geometry. No frontend pagination controls were added by this API change.

## Normalized lists

| Endpoint | `collection` values |
| --- | --- |
| `/api/trafficimages` | `cameras` |
| `/api/expresswayspeeds` | `expressways`, `checkpoints`; `segments` requires `include=segments` |
| `/api/rainforecast` | `areas` |
| `/api/forecast24h` | `periods` |
| `/api/airquality` | `regions` |
| `/api/live?feed=carparks` | `carParks` |
| `/api/live?feed=roadconditions` | `roadWorks`, `faultyLights` |
| `/api/live?feed=weatheralerts` | `strikes`, `heatStations` |
| `/api/live?feed=floods` | `alerts` |

The internal feed modules use the same contract when called directly, and a supplied `feed` must still match. Health is a fixed diagnostic report, and imageproxy returns image bytes; they do not accept list pagination.

Protocol bounds live together in `config/policy.ts::LIST_PAGINATION`: default `limit=100`, accepted 1–500; default `offset=0`, accepted 0–1,000,000. These are source-reviewed public protocol bounds, not environment-overridable settings. No new environment variable or dependency is needed; `.env.example` remains generated from the unchanged environment schema.

- `collection` defaults only for an endpoint with one collection. Multi-list endpoints require an explicit selection, even if another list happens to be empty.
- `snapshot` is the returned lowercase 64-character revision. It is required whenever normalized `offset > 0`; first-page callers normally omit it.
- Strict decimal integers only. Empty values, negatives, leading zeros, fractions, exponents, whitespace, duplicate controls, unknown fields/collections, `cursor`, conflicting Node/raw queries and unsupported combinations return 400 before provider work. Existing method/body/CORS/credential validation still applies.
- `segments` without `include=segments` is rejected before aggregation, not treated as an empty list.

### Example

```text
GET /api/live?feed=carparks&limit=2&offset=0
```

The original named collection remains the data key. Existing source/observation metadata remains alongside it. A synthetic example:

```json
{
  "success": true,
  "source": "lta_carparkavailabilityv2",
  "fetchedAt": "2026-10-24T01:00:00.000Z",
  "carParks": [
    { "id": "LTA-1", "name": "Example A", "agency": "LTA", "lat": 1.3, "lon": 103.8, "car": 12 },
    { "id": "LTA-2", "name": "Example B", "agency": "LTA", "lat": 1.31, "lon": 103.81, "car": 5 }
  ],
  "pagination": {
    "mode": "offset",
    "consistency": "snapshot",
    "collection": "carParks",
    "offset": 0,
    "limit": 2,
    "count": 2,
    "total": 7,
    "hasMore": true,
    "nextOffset": 2,
    "previousOffset": null,
    "snapshot": "<64 lowercase hexadecimal characters returned by the server>"
  }
}
```

Follow `nextOffset` with the same `limit`, `collection`, base query and returned token:

```text
GET /api/live?feed=carparks&limit=2&offset=2&snapshot=<returned-token>
GET /api/expresswayspeeds?include=segments&collection=segments&limit=500&offset=0
GET /api/live?feed=roadconditions&collection=faultyLights&limit=50
```

Multi-list pages omit the other top-level collection arrays so selecting a summary cannot accidentally return thousands of geometry points. They do not mutate the cached source object. Full-response metadata counts (for example `totalCameras`) retain their full-source meaning; `pagination.count` is the page length and `pagination.total` is the selected list's length. Existing full-camera-snapshot validators intentionally describe the unpaged shape, not the new opt-in page shape.

Empty lists and beyond-end offsets return 200 with an empty selected array, `hasMore=false`, `nextOffset=null`. A last partial page reports its actual count. `previousOffset` points back within the current list. A missing/failed selected source (`null`) returns 503 `PAGINATION_COLLECTION_UNAVAILABLE`, never a false empty success; the other available source may be requested separately.

## Revision and freshness

`server/http/listPagination.ts` hashes the exact selected array, including order, together with a format revision, logical endpoint scope and collection name. It does not sort or mutate provider data. Object serialization/order changes can cause a conservative restart even if the user-visible values are equivalent. Receipt timestamps outside the selected array do not renew/change its revision. Row observation fields are included; original provider/receipt times remain intact.

If content or ordering differs from the supplied token, return 409 `PAGINATION_SNAPSHOT_CHANGED` with a fixed instruction to restart at offset 0 without a token. Do not append that response to old pages or retry forever. A rapidly changing list may require a fresh traversal or a larger page. Replacing camera signatures/URLs also invalidates that camera-list traversal, even if the pixels might be the same.

This is a stateless consistency check, not a signed cursor, authentication token, frozen historic snapshot, lock, or server-side snapshot registry. No pages survive restart on a dedicated snapshot store. The guarantee is that accepted pages match the selected-array revision; a changed list is refused. Metadata/receipt information may reflect a later request even if the rows remain identical.

New paged responses explicitly use browser/CDN `no-store`, retain existing numeric `Retry-After` hints and CORS, and do not renew source-cache age. Existing warm-instance caches still reduce origin provider work. The service worker treats requests with `limit`, `offset`, `collection` or `snapshot` as network-only under its existing deadlines, without saving or offline fallback. Otherwise an installed app could bypass revision checks and accumulate unlimited page-token cache keys. Existing full-feed offline fallback and original receipt times are preserved; no existing data cache is purged. The new behavior applies after worker update/activation.

## Raw LTA lists

```text
GET /api/traffic?limit=100&offset=0
GET /api/traffic?limit=100&offset=100
GET /api/vms?limit=25&offset=0
GET /api/traveltimes?limit=100&offset=0
GET /api/trafficflow?limit=500&offset=500
```

Each call maps `offset` to LTA `$skip`, validates the provider window and slices to `limit`. It does not forward a made-up `$top`/cursor or download the whole raw speed-band dataset to serve one small page. `value` remains the array key. New paging metadata uses `consistency="live"`, `total=null`, `snapshot=null`, count/navigation/limit/offset and `limitReached`. Snapshot/collection controls are rejected for these endpoints because a full-list revision cannot be verified from one provider window.

`hasMore` is true when fetched records exist beyond the requested slice or the provider window is full (500). A full last window may therefore require one final empty request to establish the end. At the protocol offset cap, `nextOffset=null` and `limitReached=true` explicitly report that traversal cannot continue; they do not claim the provider dataset has ended.

Legacy `$skip` alone and no-query calls preserve their original response and Int32 bounds. `$skip` may be combined with `limit` as an alias, within new pagination bounds, but never with `offset`. Unknown total means unknown, not zero. Provider insertions/deletions/reordering between native calls can cause duplicates/misses; there is no advertised stable unique ordering or snapshot transaction to guarantee a consistent bulk export. Use normalized endpoints where applicable; a future historic export would need durable storage/versioning.

## Work and verification

`withListResponse` composes pagination with the existing schema/CORS/error boundary and a shared Node/Web JSON sender. API modules supply their named collections and existing business payloads. The public live dispatcher validates paging controls for its selected feed before entering it. No request/response methods are monkey-patched and no request state is global.

Pagination reduces response size and supplies navigation. It does not turn in-memory arrays into indexed queries or remove a normalized endpoint's cold aggregation/pagination cost. Server caches remain bounded as documented in `caching.md`; no database indexes can be added to these provider feeds. The existing complete-list dashboard behavior is deliberately preserved.

- Final full suite: 264 passing Node tests, zero failures/skips, including the wrapper's four offline Python cases; 18 new pagination groups.
- Tests cover all normalized collections and native list entry points in Node and Web, direct/multiplexed routes, complete-list compatibility, early bounds/query rejection, correct first/middle/last/empty/beyond-end pages, revision changes/scopes, sibling omission, partial-source failure, original metadata, CORS/retry hints/cache headers and network-only worker traversal without disturbing ordinary offline feeds.
- Type checking, transport audit, production build, generated-environment consistency (existing test) and whitespace checks passed. The initial synthetic rain fixture omitted the existing required validity text; corrected the fixture rather than loosening validation. An intermediate test invocation without loopback permission failed its existing socket fixture; the final full suite ran with the established loopback permission and passed.
- Only synthetic provider/camera/model/storage ports were used for policy tests. No real camera metadata/presigned image, user storage, permission or notification was requested. The earlier interactive-browser approval usage-limit block remains; no alternate browser/protocol workaround or actual visual/performance claim is used. Live preview checks, if recorded below, are selected HTTP/deployment checks only.

## Preview publication

Implementation `7569e7a088f3e9c00c4c85e6d651256e0a27e378` is published in attached draft [PR #26](https://github.com/Mikazukiangus/live-traffic/pull/26). GitHub Checks runs `40055624595` and `40055651308` and Vercel deployment/feedback checks passed at that head. Required CI job diagnostics confirm 264 passing tests, zero failures/skips, plus type checks, security audit and build.

[Preview](https://live-traffic-eh739cqq8-carbon-bc04.vercel.app) deployment `dpl_8nKWhLKf7LbUo6NBChNdRZuoNcFR` is READY for the intended project/team, preview branch and implementation SHA. Selected authenticated checks:

- Homepage returned HTTP 200.
- `/api/rainforecast?limit=2` returned two areas, `total=47`, offset 0 and next offset 2.
- A continuation at offset 2 with the returned snapshot returned HTTP 200, two areas, next offset 4 and the identical revision.
- A deliberately incorrect revision at offset 2 returned HTTP 409 `PAGINATION_SNAPSHOT_CHANGED`; `limit=0` returned HTTP 400 `INVALID_REQUEST`.
- Rendered `/sw.js` returned HTTP 200, contains the paging-network-only branch and no unreplaced timeout placeholder.

These verify selected deployed API paths and worker-source availability. They do not demonstrate an actual provider revision change between two calls, interactive browser/worker activation, current health of every other feed or measured performance. No real camera metadata/photo, user storage/permission or notification was probed. Main/production and separate PR #23 remain unchanged. The follow-up records documentation only; PR #26 awaits explicit approval to merge.
