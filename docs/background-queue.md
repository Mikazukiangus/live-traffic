# Background queue

Preview branch: `codex/browser-background-queue`, based on main `af19961`.
The pending cross-tab storage/wake-lock work remains separately reviewable in PR #23 and is not merged into this branch.

## Operations and placement

| Operation | Placement | Reason |
| --- | --- | --- |
| Vehicle analysis for current camera photos | **Migrated to analysis queue** | Optional CPU/model/image work should wait for an idle turn, prioritize selected cameras and stop when the image/view becomes obsolete. Existing ONNX worker inference remains on the visitor's device. |
| Recording recent commute travel-time receipts | **Migrated to history queue** | Optional trend persistence can run after render. Preserve original receipt times and let the domain repository validate route identity, deletion, age and spacing at execution. |
| Incident notification delivery attempts | **Migrated to notification queue** | Bound bursts independently of inference; cancel obsolete/disabled alerts before dispatch. Existing alert policy owns deduplication, successful receipts and bounded retries. Permission prompts remain direct user actions. |
| LTA paginated speed aggregation / future cache warming | Current response path retained | A durable refresh job needs shared result storage, a refresh/status contract and server-side admission policy. An instance-local cache written by a separate function cannot serve every replica reliably. That is a separate backend migration. |
| Live incident/camera/weather/travel API reads and user refresh | Foreground request path retained | Their answers are needed to render live data; current shared resources coalesce requests and retain honest failure/age states. |
| User save/delete/alert preferences and permission/install actions | Foreground action retained | Confirm requested changes promptly and preserve browser user activation for permission/install APIs. Background optional history work cannot delay these actions. |

The chosen queue is **device-local and page-lifetime**, with no added account/service/dependency or server transmission of job payloads. The current app has no durable mutation backend, database, real dispatch/email/SMS flow or server-owned user notification subscriptions. Browser permissions, saved commutes and canvas/model context remain browser-owned. [Vercel Queues](https://vercel.com/docs/queues) is the durable topic/consumer option for a future server job flow; it requires actual server-owned payloads, idempotent consumers and durable result storage where results are read later.

## Implementation

- `src/features/background/taskQueue.ts`: transport-free keyed queue with a pending cap, independent lanes, priorities, expiry, cancellation, explicit retry admission, terminal results and per-key identity-safe cleanup. No raw error, job key, image URL, title/body, receipt or commute enters failure diagnostics.
- `src/features/background/browserQueue.ts`: lazy singleton per page. Optional analysis/history work uses `requestIdleCallback` with a deadline; unsupported browsers fall back to a timer. Notifications promote scheduling to an immediate timer turn. New enqueues do not continually reset the original idle turn. [MDN scheduling guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback) documents idle callbacks, timeout use and limited browser availability.
- Three lanes (`notifications`, `history`, `analysis`), each with **one physically running operation**. Notification/history tasks can progress while a model job awaits inference. Analysis never overlaps another analysis job in this page's shared session, even if cancellation is ignored. This is concurrency control, not a new parallel CPU worker for canvas/tensor preparation. ONNX's existing worker still performs inference.
- `src/features/vehicle-counting/vehicleJobs.ts` + `useVehicleCounts.ts`: current-photo jobs, selected-camera ordering, exact photo result checks, hidden/disabled cancellation, obsolete job replacement, bounded same-photo retries and disposal. Failures do not fabricate counts. `engine.ts` checks cancellation before/after model/image loading and between inference tiles; `loadImage.ts` propagates cancellation to detach handlers/remove its source.
- `src/features/commutes/historyJobs.ts` + `MyCommute.tsx`: captured/de-duplicated receipt batches after render, original timestamp preservation, disposal cancellation and fixed failure/recovery notices. No generic write retry. The callback awaits either the current synchronous repository or the async adapter proposed in PR #23; both operate on execution-time domain state. PR #23 also touches the receipt effect, so that effect must be reconciled when both PRs are approved; keep this queue wrapper around its coordinated repository call.
- `src/features/commutes/notificationJobs.ts`, `commuteAlertQueue.ts`, `notificationDelivery.ts`, `src/utils/commutes.ts`: existing business alert queue dispatches through the shared notification lane. Its signal is canceled on removal/disable/expiry/disposal. Permission/cancellation is rechecked after worker lookup and before constructor fallback. User permission requests are never queued or automatically repeated.

## Policy

Defaults are validated centrally in `config/schema.ts`, projected through `config/client.ts`, and regenerated into `.env.example`:

| Setting | Default | Bounds |
| --- | --- | --- |
| `VITE_BACKGROUND_MAX_PENDING` | 32 waiting jobs | 4–256 |
| `VITE_BACKGROUND_IDLE_TIMEOUT_MS` | 1000 ms | 1–10000 |
| `VITE_BACKGROUND_JOB_MAX_AGE_MS` | 120000 ms | 1000–600000 |

No new environment values are required. Running jobs have one slot per lane in addition to the waiting cap. Duplicate active keys share the original promise/lifetime. Selected-camera priority can change without replacing the job. Expired/full jobs settle with a fixed result and redacted lane/code diagnostic; no sensitive keys appear in logs or stats.

Only read-only/recomputable photo analysis opts into automatic retry: **two total attempts**, separated by the existing validated `VITE_FEED_RETRY_MS` (default 30 seconds), and both must fit the original lifetime. Invalid model counts are rejected. A failed current photo does not loop on every render; a new photo is new work. History writes have **one execution attempt**; domain idempotency/validation remains in place, and later live receipts recover the UI warning. Notifications have **no generic executor retry**: existing policy still allows at most three delivery attempts, 15 seconds apart, within two minutes. Queued time counts toward expiry. No permission denial/unsupported-browser retry loop was added.

Cancellation is cooperative. Queued jobs never start after cancellation/expiry; started jobs keep their physical lane until they return, and canceled/stale results are suppressed. A native ONNX tile or browser-accepted notification cannot be forcibly undone. Runtime initialization remains shared and bounded by existing asset deadlines; canceling one photo does not abort another consumer's shared model initialization. A stuck non-cooperative native operation can hold its lane; this does not block the other lanes. No claim of exactly-once OS display, full worker preemption, or measured speedup is made.

Closing/reloading the page discards pending jobs, keys and notification receipts. Camera work is regenerated from current photos on a later visit; local trend/alert jobs are best effort while the page is open. Nothing is persisted as a job with a possibly expired signed photo URL, and no server worker runs after the page closes. This is not a durable hosted queue. Browser tabs each have their own queue; cross-tab alert leadership/deduplication was not added. Existing user-data persistence policies remain separate.

## Verification

- 229 full-suite Node tests passed, zero skips: main's 214-test baseline plus 15 new queue/integration groups, including the existing wrapper's four offline Python cases.
- Type checking, transport security audit, production build, generated environment-example check and whitespace checks passed. No dependencies/lockfile were changed.
- Tests verify deferred execution, urgency/priority, independent lanes, one physical slot, deduplication/original expiry, capacity, cancellation with late results and key replacement, retry backoff/deadlines, disposal/timer cleanup, photo replacement/visibility/invalid-result handling, captured/history receipts and failure feedback, notification retry bounds/removal and permission revocation, image cancellation/pre-aborted work, and config bounds.
- The first targeted image-cancellation test aborted before the deadline helper's microtask had created an image; corrected the fixture to start the synthetic image before asserting active-request cleanup. Pre-aborted cancellation separately verifies no image creation. No runtime change was needed for that fixture failure.
- Ports/timers/images/model results/storage/notifications are synthetic. No real provider outage, image/camera metadata, browser storage, permission or notification prompt was requested. The earlier browser approval usage-limit block remains; no alternate browser/protocol workaround or browser performance/visual pass is claimed.

The queue changes are independent of unmerged PR #23. Explicit approval is required before merging this preview into main. See Turn 144 in `CHAT_COMMENTS_AND_INSTRUCTIONS.md` for publication evidence.
