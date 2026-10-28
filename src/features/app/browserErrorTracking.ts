import { config } from '../../../config/client';
import { ERROR_TRACKING } from '../../../config/policy';
import { installErrorTracking, safePage, type BrowserErrorReport, type TrackedError } from '../../../shared/errorTracking';
import { reportApplicationFailure } from '../../../shared/applicationDiagnostics';
import { withRequestDeadline } from '../../../shared/requestDeadline';

/** No storage, cookies, user agent, full URLs, request payloads, replay or retry queue. */
export function installBrowserErrorTracking(target: Window, options: {
  fetch?: typeof fetch; now?: () => number; notice?: (errorId: string) => void;
} = {}) {
  let windowStart = 0, sent = 0, disposed = false;
  const seen = new Map<string, string>(), cancellation = new AbortController();
  const transport = (event: TrackedError) => {
    if (disposed || !event.mechanism || (event.scope !== 'app' && event.scope !== 'page')) return;
    const now = (options.now ?? Date.now)();
    if (now - windowStart >= ERROR_TRACKING.windowMs) { windowStart = now; sent = 0; seen.clear(); }
    if (seen.has(event.fingerprint)) return seen.get(event.fingerprint);
    if (sent >= ERROR_TRACKING.browserBudget) return;
    seen.set(event.fingerprint, event.errorId); sent++;
    if (['window_error', 'unhandled_rejection', 'react_uncaught'].includes(event.mechanism)) options.notice?.(event.errorId);
    const body: BrowserErrorReport = { version: 1, errorId: event.errorId, scope: event.scope,
      mechanism: event.mechanism, page: event.context.page, release: event.context.release,
      exceptionType: event.exceptionType, locations: event.locations };
    // Reporting failure is intentionally silent: retries could amplify an outage or recurse.
    void withRequestDeadline(ERROR_TRACKING.timeoutMs, async signal => {
      const response = await (options.fetch ?? fetch)('/api/live?feed=errors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', keepalive: true, signal,
      });
      await response.body?.cancel();
    }, cancellation.signal).catch(() => {});
  };
  const restore = installErrorTracking({ context: () => ({ ...config.errorTracking,
    page: safePage(new URLSearchParams(target.location.search).get('page') ?? 'cameras') }), transport });
  const error = (event: ErrorEvent) => {
    // Resource-load events have no ErrorEvent payload; existing camera/chunk recovery owns those.
    if (!('error' in event)) return;
    event.preventDefault();
    reportApplicationFailure('app', event.error, 'window_error');
  };
  const rejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    reportApplicationFailure('app', event.reason, 'unhandled_rejection');
  };
  target.addEventListener('error', error);
  target.addEventListener('unhandledrejection', rejection);
  return () => {
    if (disposed) return;
    disposed = true; cancellation.abort(); seen.clear(); restore();
    target.removeEventListener('error', error); target.removeEventListener('unhandledrejection', rejection);
  };
}

/** A fixed, dismissible notice also works if React has already unmounted the root. */
export function showSafeErrorNotice(errorId: string) {
  if (document.getElementById('trafficpulse-error-notice')) return;
  const notice = document.createElement('section');
  notice.id = 'trafficpulse-error-notice'; notice.setAttribute('role', 'alert');
  notice.className = 'fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-lg rounded-xl border border-slate-300 bg-white p-4 text-slate-900 shadow-lg';
  const text = document.createElement('p');
  text.textContent = 'Something went wrong. Please try again or reload the page.';
  const reference = document.createElement('p');
  reference.className = 'mt-2 break-all text-xs text-slate-500';
  reference.textContent = `Reference: ${errorId}`;
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.textContent = 'Dismiss';
  dismiss.className = 'mt-3 min-h-11 rounded-full border border-slate-300 px-4 text-sm font-semibold';
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(text, reference, dismiss); document.body.append(notice);
}
