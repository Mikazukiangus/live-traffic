import { captureException, type BrowserErrorReport } from './errorTracking.ts';

/** Original exceptions are projected into fixed types/numeric locations; never serialized. */
export function reportApplicationFailure(scope: 'api' | 'page' | 'app', error?: unknown, mechanism?: BrowserErrorReport['mechanism']) {
  const event = captureException({ event: 'application_failure', scope: ['api', 'page', 'app'].includes(scope) ? scope : 'app', code: 'INTERNAL_ERROR', mechanism }, error);
  return { success: false, code: 'INTERNAL_ERROR', error: 'Something went wrong. Please try again.', errorId: event.errorId };
}

export function reportNotificationFailure(operation: 'permission' | 'delivery') {
  captureException({ event: 'notification_failure', operation: operation === 'permission' ? 'permission' : 'delivery', code: 'NOTIFICATION_FAILED' }, undefined, true);
}
