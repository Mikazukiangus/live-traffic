# Concurrent request updates

Implemented on `codex/atomic-request-updates`, based on main `1fcb1b0`. No database or authenticated mutation API exists in this app. The confirmed races were in browser async operations and the service worker's shared response cache.

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

Preview publication and deployed checks are recorded in Turn 141 of `CHAT_COMMENTS_AND_INSTRUCTIONS.md`. Merge into main requires explicit user approval.

## Preview publication

Implementation commit: `adc2e3aa867a95ff8b83548be2a8e4491a89673f`.
Draft [PR #22](https://github.com/Mikazukiangus/live-traffic/pull/22) is attached to the chat. Both GitHub Checks runs (`39967940692`, `39968000143`) and Vercel deployment/feedback checks passed for that head; CI diagnostics confirm 214 passing tests and zero skips.

[Preview](https://live-traffic-4w0o7c0cb-carbon-bc04.vercel.app) is deployment `dpl_3odtf45nSCSJ6jehbiHU74ZXxq5u`, READY for the intended project/team and branch. Its authenticated homepage, referenced entry bundle and rendered service worker returned HTTP 200. The served worker includes the serialized version guard and configured timeout replacement. No browser execution/activation or real permission interaction is established by these HTTP checks. This publication note is documentation only; the implementation proof is pinned to the commit above. Main/production await explicit merge approval.
