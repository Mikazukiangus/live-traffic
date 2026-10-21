# Saved commute storage and route history

## Scope

The first data model fix validates browser-saved commutes/history and isolates travel-time trends by exact ordered route. There is no database or account synchronization. The existing three-commute/four-leg limits and whole-road estimates for KPE/MCE remain.

## Access boundary

Saved commutes/history are scoped to an origin and browser profile, not an authenticated account. There is no signed-in user, owner ID, role policy or server-side record endpoint. Anyone using the same browser profile can access and edit its saved commutes. The repository's ID/route-key/revision checks protect data consistency; they do not establish identity or record ownership. Browser localStorage is not a private multi-user account boundary.

If account synchronization is added, authenticate on the server and scope every record read/write/delete/history lookup to that trusted user (and tenant where applicable), with explicit role permissions for any broader access. Never accept a client-supplied role/owner ID as authorization. Test anonymous requests, two different users and privileged-role exceptions. See [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Module ownership

- `shared/commutes/model.ts`: types, limits, pure JSON decoders, saved-record validation and canonical ordered route keys. Supported road codes are supplied from the existing expressway catalogue, not duplicated here.
- `src/features/commutes/commuteRepository.ts`: storage migration/protection, in-memory state, subscriptions, commands and history integrity. Storage and clock are injected for tests.
- `src/features/commutes/commuteStorage.ts`: lazy browser adapter using localStorage and the catalogue.
- `src/utils/commutes.ts` and `commuteHistory.ts`: compatibility entry points and React subscription/notification or trend presentation behavior.
- `MyCommute.tsx`: derives all card summaries once and records eligible live, non-estimated receipts in one repository batch effect.
- `useCommuteHistory.ts`: selects current-route samples/trends for each card. It subscribes to the repository instead of retaining a second route's sample state or writing per card.

## Versioned records

New writes use separate keys, preserving the old keys unchanged:

- `trafficpulse.commutes.v1`: `{schemaVersion: 1, commutes: Commute[]}`.
- `trafficpulse.commuteHistory.v1`: `{schemaVersion: 1, histories: [{commuteId, routeKey, samples: [[receivedAt, minutes], ...]}]}`.

The timestamp in a sample is the browser's receipt time, as in the previous implementation. It is not claimed to be LTA's issue/update time. Samples are finite, nonnegative, ordered, unique by receipt time and limited to the last three hours. Repeated/out-of-order receipts do not add a sample. Existing pacing remains: unchanged values every four minutes or changed values at least one minute apart. Only live, non-estimated totals enter history.

`recordBatch` validates every receipt against the current route/revision, prunes expired/obsolete history, and applies the same sample spacing before committing once. Three eligible commutes therefore need one whole-history write/publication. If neither samples nor pruning change, no write/publication occurs. A previously failed history write is retried even if the latest valid receipt adds no sample; its recovery updates the notice without concealing failures on another key. Protected stores remain untouched. The compatibility `record`/`recordSample` path delegates to the same batch command and retains its previous sample-return contract.

`routeKey` contains the saved `routeRevision` and canonical JSON description of ordered `[code, direction, from, to]` legs. Legacy records receive revision zero; the repository increments it on each route-defining edit and ignores caller-supplied resets. This also prevents old history returning after a partial history-write failure and an A-to-B-to-A edit/reload. It uses normalized endpoint case/spacing and the full description rather than a truncated hash. It contains no name or alert setting and is not a provider route ID. Each commute has at most one active history; a route change removes it. The saved revision is an integrity marker; this slice does not archive previous route revisions.

Saved legs require a known road code. KPE/MCE use direction 0 and empty endpoints for whole-road estimates. Other roads require direction 1 or 2 and distinct nonblank endpoints. This validates saved structure; directed-path connectivity and provider endpoint aliases remain the separate second implementation slice.

## Migration and recovery

1. Loading does not write anything. If the v1 commute key is absent, decode the old `trafficpulse.commutes` array. Recover individually valid records, keep the first valid record per ID, and respect the existing limits. Show a notice if entries could not be recovered.
2. Valid edits write the v1 envelope to its new key. Old `trafficpulse.commutes` and `trafficpulse.commuteHistory` values remain unchanged. An empty v1 commute list is authoritative, so deletion cannot resurrect legacy routes on reload.
3. Legacy history has no route identity. Do not attach it to the current route: that could reproduce the false trend. Start new history and show a brief explanatory notice when old history exists. The original history value remains available in its old key.
4. If an existing v1 store is malformed, partly invalid or from an unsupported version, recover valid readable entries where possible but protect **both** current stores from writes for that page session. Do not fall back to an older commute list. New edits/history can work in memory, with a visible notice that they last only in this tab. The original bytes remain untouched; automatic repair/export is not implemented.
5. Blocked reads protect unreadable stores. Failed writes keep valid in-memory edits and history with an unavailable-storage notice. A successful write to one key cannot conceal a failure on the other key. Reload after restoring access to re-read protected data. With quota failures, a later successful write to the failed key clears its write failure.

For a future repair tool, first export the protected keys privately, then migrate known versions explicitly. Do not ask users to paste their saved commute contents into logs or public issues. Preserved legacy keys intentionally use some extra browser storage; cleanup needs an explicit retention/recovery policy and is not automatic in this change.

## Route changes and UI

- Save, delete, notification changes and history commands use the same repository validation and subscriptions.
- Changing a leg's road, direction, endpoint or position invalidates its commute history. Old effects cannot record against a route key that is no longer current.
- A rename, notification toggle or endpoint case/spacing-only edit preserves history.
- Returning from route A to B and then A starts fresh, including when the feed is unavailable during edits.
- The hook reads current-route samples on the edit render, before effects. It cannot briefly show the previous route's sparkline or trend while waiting for a new sample.
- The storage notice is accessible through `role="status"`. Existing notification permissions and corridor-wide incident matching are unchanged.

## Verification and limits

Focused tests cover legacy migration, non-destructive recovery, unsupported versions, malformed records/samples, route edits, renames/alerts, leg ordering, deletion/reload, blocked storage, partial write failures, subscriptions and sample receipt timing. Browser verification uses only isolated synthetic data with the real commute editor/card and no provider requests.

Cross-tab synchronization and conflict resolution are not introduced. Storage remains browser-local and can be cleared by the browser. This slice does not fix travel-time path continuity, introduce route graphs or provider observation IDs, change incident/camera models, provision a database, or operate a real booking service.
