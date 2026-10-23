/** Fixed application diagnostics: never accept an exception, props, URL or browser event. */
export function reportApplicationFailure(scope: 'api' | 'page' | 'app') {
  console.error(JSON.stringify({ event: 'application_failure', scope: ['api', 'page', 'app'].includes(scope) ? scope : 'app', code: 'INTERNAL_ERROR' }));
  return { success: false, code: 'INTERNAL_ERROR', error: 'Something went wrong. Please try again.' };
}

export function reportNotificationFailure(operation: 'permission' | 'delivery') {
  console.warn(JSON.stringify({ event: 'notification_failure', operation: operation === 'permission' ? 'permission' : 'delivery', code: 'NOTIFICATION_FAILED' }));
}
