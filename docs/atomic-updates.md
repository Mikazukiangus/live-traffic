# Concurrent request updates

**Current preview follow-up:** `codex/cross-tab-atomic-storage` extends the released PR #22 fixes with cross-tab commute coordination, a single-record storage commit and wake-lock ownership. See the follow-up section below. The earlier scope/limits describe the PR #22 release and are superseded for coordinated commute storage on this preview only.

Implemented on `codex/atomic-request-updates`, based on main `1fcb1b0`; released through PR #22 as main merge `1252d0f3240cfd71d9c38bb8c5d337a5a93213be`. No database or authenticated mutation API exists in this app. The confirmed races were in browser async operations and the service worker's shared response cache.

## Where updates could race

| Location | Before | Atomic boundary now |
| --- | --- | --- |
| `src/features/feeds/polledResource.ts`, `src/features/weather/rainResource.ts`, `src/features/traffic/speedResource.ts`, `src/utils/apiHealth.ts` | Synchronous observers could refresh while the busy state was published but before the pending promise was assigned. Final observers could start new work before the previous operation finished its cleanup. | `shared/singleFlight.ts` installs the pending promise before invoking work or observers. Start, response and final state publications remain inside that ownership period. All joiners receive the pending promise; scheduling happens after release. Speed full-payload upgrades remain serialized. |
| `src/utils/usePolledJson.ts` | Interval/manual refreshes could overlap. A request for the previous URL could update state after a URL change or component cleanup. Data, status and receipt had separate setters. | Each URL/poll configuration owns a retained resource and immutable snapshot. Refreshes coalesce; subscriptions/timers detach on cleanup. An old resource can finish but cannot publish into its replacement. Validation, partial/offline status, Retry-After and original receipts are preserved. The shared hook also supplies its snapshot for server rendering. |
| `public/sw.js` | Several clients could fetch the same key concurrently; a slow older response or slower `cache.put` could replace the newer offline copy and its receipt. | Assign a request sequence before async work, then serialize comparison and `cache.put` per cache name + absolute URL. A late earlier sequence is skipped after a newer successful commit. Failed HTTP/storage answers do not supersede a usable older success. Navigation aliases share the shell key. API, shell and cache-first paths participate; unrelated URLs proceed independently. |
| `src/utils/nearMeResource.ts` / `src/utils/nearMe.ts` | Old location callbacks could overwrite newer coordinates/denials and reverse the opt-in preference. An automatic permission lookup could finish after a manual tap and launch a newer automatic request. | A generation is reserved before observers or browser work. Only the current generation commits location and preference, with the preference committed before notification. Auto-resume verifies its original generation after permission resolves. Coordinates remain in memory. |
| `src/utils/installPromptResource.ts` / `src/utils/installPrompt.ts` | Two clicks could prompt with the same one-shot event; completion could read/clear a newer event after awaiting. | Single-flight admission consumes and captures the event synchronously. Completion never touches a replacement event. Rejected prompts resolve safely with a fixed diagnostic that omits the event/exception. |
| `src/features/commutes/CommuteCard.tsx`, `CommuteEditor.tsx`, `commuteRepository.ts` | Delayed permission approval saved a captured whole commute, overwriting edits or resurrecting a deletion. Conversely, an editor opened earlier could overwrite a newer alert flag. | `setAlerts` reads and patches only the current record, without an await. `saveDetails` updates only the editor's name/route fields while preserving current alerts, requires an existing record for edits, and rejects new-ID collisions. Deletion stays deleted. The button's immediate ref guard prevents duplicate permission requests before React rerenders. Route revision/history validation still runs. |

The new tests force observer re-entry and reverse completion order, rather than relying on timing or a live provider outage. They also hold a cache write open while another request finishes, verify unrelated keys keep progressing, check failed newer writes, and exercise both commute-save/permission orders.

## Existing protections reviewed

- `server/providers/dataGovClient.ts`: the promise gate serializes provider admission; cooldown uses `Math.max` so a shorter concurrent cooldown cannot shorten a longer one. Identical requests coalesce within an instance.
- `server/weather/rainService.ts` and `server/traffic/speedService.ts`: one pending refresh owns each retained cache update within an instance. No reset/invalidation method admits a second owner during that update.
- `server/http/circuitBreaker.ts`: synchronous half-open reservation and generation checks already prevent stale request outcomes from undoing a newer circuit transition. Existing deterministic concurrency tests remain in the suite.
- Camera metadata already coalesces per mounted hook. Vehicle counting has one running loop and consumers require an exact photo URL before displaying a result. Synchronous JavaScript map/counter updates with no await are not independent database transactions.

## Scope and limits

These are atomic admission/commit rules within one resource owner, one repository instance, or one active service-worker instance. They are not distributed locks across Vercel function instances, devices, or overlapping service-worker versions. No durable server mutation was added. Worker ordering reflects request admission order, not a comparison of provider observation timestamps; callers still receive their own network answer. Idle per-key worker records are removed once all requests/writes finish. Existing offline headers and receipt ages survive fallback.

Saved commutes still use the existing synchronous, tab-local repository backed by localStorage. Concurrent edits in separate tabs are **not transactionally coordinated**: each tab holds its own snapshot, and commutes/history use separate storage keys. This change fixes asynchronous request completions within the active repository; it does not make multi-key persistence crash-atomic or make localStorage a cross-tab transaction engine. A future cross-tab editing feature should use IndexedDB transactions or an explicit Web Locks/storage-refresh protocol before claiming that guarantee. Failed/unsupported storage still preserves the existing in-memory recovery and original-copy policy.

## Verification

- 214 full-suite Node tests passed, zero skips, including 11 new concurrency groups and the existing wrapper's four offline Python cases.
- Type checking, transport security audit, production build and whitespace checks passed.
- The first full run caught the migrated polling hook missing a server snapshot in an existing server-rendered weather test. Added the snapshot and reran successfully. A final targeted review also covered the inverse editor/permission completion order.
- All race/error checks use synthetic promises, storage ports, geolocation/install events, HTTP transports and the rendered worker in a Node VM. They do not prompt for permissions, install the app, touch real browser storage or request camera metadata/presigned photos.
- Interactive browser checks remain unverified: the earlier automatic approval review reached its usage limit and prohibited alternate browser/protocol workarounds. No workaround or visual pass is claimed.

Preview publication is recorded in Turn 141 of `CHAT_COMMENTS_AND_INSTRUCTIONS.md`; the approved main merge and production checks are recorded in Turn 142.

## Preview publication

Implementation commit: `adc2e3aa867a95ff8b83548be2a8e4491a89673f`.
Draft [PR #22](https://github.com/Mikazukiangus/live-traffic/pull/22) is attached to the chat. Both GitHub Checks runs (`39967940692`, `39968000143`) and Vercel deployment/feedback checks passed for that head; CI diagnostics confirm 214 passing tests and zero skips.

[Preview](https://live-traffic-4w0o7c0cb-carbon-bc04.vercel.app) is deployment `dpl_3odtf45nSCSJ6jehbiHU74ZXxq5u`, READY for the intended project/team and branch. Its authenticated homepage, referenced entry bundle and rendered service worker returned HTTP 200. The served worker includes the serialized version guard and configured timeout replacement. No browser execution/activation or real permission interaction is established by these HTTP checks. This publication note is documentation only; the implementation proof is pinned to the commit above. The user subsequently approved this merge; release evidence follows.


## Production release — 23 October 2026

The user explicitly approved the merge after the scope/browser limitations above were disclosed. Final PR head `17e9754319bd5bbef37389dc01325f158c5a0440` passed both GitHub Checks and Vercel checks. CI diagnostics confirmed 214 passing tests and zero skips. PR #22 was marked ready and merged with that expected head as `1252d0f3240cfd71d9c38bb8c5d337a5a93213be`; local main was fast-forwarded.

Production deployment `dpl_D56XazVJxDcgAHZ4gVuN1MVdBaWT` is READY for the intended project/team, main merge SHA and production target. Its aliases include [the canonical production site](https://live-traffic-carbon-bc04.vercel.app). Authenticated homepage, its referenced entry bundle and `/sw.js` returned HTTP 200. The served worker includes the version guard and rendered timeout settings. These confirm deployed artifacts; they do not establish interactive worker activation or permission behavior. No new live provider/camera/permission probes were performed. The concurrency scope and earlier browser approval limitation remain as documented above.


## Follow-up: cross-tab commute commits and wake-lock ownership (24 October 2026)

Two races remained after PR #22:

1. **Shared persistence:** `commuteStorage.ts` created one cached repository per tab. Each wrote an entire commute/history snapshot through separate localStorage keys. Two tabs loaded before either write could lose one tab's creates, alert edits or samples. Route/history invalidation could also be split if one write failed. This is reproduced in the new regression test before exercising the fix.
2. **Screen wake locks:** `wallDisplay.ts` checked only the granted sentinel before awaiting the next acquisition. Repeated visibility events could start more than one request. A slow request could overwrite the held sentinel, and a late rejection/release callback could clear the displayed state of a newer owner.

### Commute persistence protocol

`src/features/commutes/coordinatedCommutes.ts` wraps the existing validated domain repository. `commuteStorage.ts` supplies the actual browser ports:

1. Queue commands within the tab and capture mutable inputs before queueing.
2. Acquire the exclusive, fixed `trafficpulse.commuteState.v2` Web Lock. Browser admission uses the existing validated request timeout; it never steals another tab's lock.
3. Reread the current envelope **inside** the lock and construct the existing domain repository over isolated memory. Apply the field-specific mutation against this current state. Old-route receipts remain ineligible after edits/deletion.
4. Commit commutes and history with one `localStorage.setItem('trafficpulse.commuteState.v2', serializedEnvelope)` while still holding the lock. Publish the snapshot after that commit, then return/release. No network, notification prompt or other awaited work runs inside the critical section.
5. Subscribe to storage/visibility changes only while there are consumers. Read the current complete envelope instead of trusting potentially delayed event payloads. Preserve snapshot/commute-array identity when values are unchanged, including history-only changes, so receipt effects cannot create a notification/write loop.

The envelope is `{schemaVersion: 2, revision, commutes: {schemaVersion: 1, commutes: [...]}, history: {schemaVersion: 1, histories: [...]}}`. Its revision increments under the same lock. Version/field validation uses the existing codecs. Original v1/legacy keys are read for migration only when the new envelope is absent, then remain untouched. The first valid state-changing command creates the new envelope. New code uses the new key exclusively; older deployed tabs writing v1 cannot overwrite it. Old-version tabs do not receive new-version edits and should be reloaded. Clear all TrafficPulse commute keys to fully reset saved/migrated data; removing only the v2 key permits migration from preserved originals again.

Missing/rejected/timed-out Web Locks, blocked reads or failed writes switch this tab to memory-only operation with a user-visible notice. There is no uncoordinated persistent-write fallback. A failed commit keeps the requested edit in that tab without later replaying its stale snapshot over another tab. Malformed/unknown saved versions are preserved, with only recoverable valid entries used locally. Original-copy and route/history validation policies remain. The core synchronous domain repository remains a reducer over isolated memory; the browser adapter is the only shared persistence owner.

Save/delete/alert controls now await command completion, guard duplicate clicks immediately, and show fixed failure/conflict messages. An editor completion cannot close a newer editor after its original unmount. Background sample recording handles rejected updates; storage notices are published by the repository. Public browser mutation helpers now return promises; synchronous reads/subscriptions remain stable. Existing internal domain tests retain their synchronous API.

This is coordination among same-origin browser contexts using this protocol and one visible complete-value storage update. It is not server-side/distributed locking, cross-device sync, a disk-flush durability guarantee, or cross-version synchronization. Same-field edits serialize in command order; this does not add collaborative merge semantics or optimistic conflict comparison. No server database/authentication was introduced. Web Locks coordinates contexts sharing the origin; localStorage alone provides no read-modify-write lock. Primary references: [MDN Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) and [HTML storage specification](https://html.spec.whatwg.org/multipage/webstorage.html#the-storage-interface).

### Wake-lock ownership

`src/utils/wakeLockResource.ts` reserves acquisition through the existing single-flight helper. Only the active resource may publish a granted lock. Hidden/disposed/already-released results are released; release callbacks compare sentinel identity before clearing state. Disposal clears ownership before releasing its sentinel, and late rejections cannot update the next effect's state. `wallDisplay.ts` supplies the browser request and visibility listener. This does not retry a battery/policy refusal or prevent the browser from releasing a lock.

### Verification

All 228 full-suite Node tests pass, zero skips, including 14 new groups and the wrapper's four offline Python cases. Type checking, transport security audit, production build and whitespace checks pass. Tests share an actual synthetic backing map between independently constructed adapters and an exclusive lock port; they assert durable writes occur only while the lock is held. Coverage includes baseline lost-update reproduction, concurrent creates/capacity/collisions, alert+route edits, stale deletion/receipts, merged samples, complete migration and failed commits, malformed copies, storage refresh/cleanup/stable arrays, unsupported/rejected locks, queued-input capture and wake acquisition/release/disposal ordering.

All tests used synthetic storage/lock/wake ports. No real browser storage, permission, install event, camera metadata/photo or live provider outage was touched. Real multi-tab browser/UI verification remains unperformed after the earlier automatic approval usage-limit rejection; no alternate browser/protocol workaround was attempted. Runtime changes stay on a preview branch until explicit merge approval. Publication results are recorded in Turn 143.
