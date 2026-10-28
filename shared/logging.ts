import { isErrorId, safeContext, safeRelease, type ErrorContext } from './logContext.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
const EVENTS = new Set(['application_log', 'upstream_failure', 'application_failure', 'notification_failure', 'auth_storage_failure',
  'authentication_unavailable', 'authentication_event', 'client_exception', 'api_rate_limit', 'user_rate_limit', 'request_user_context',
  'background_job_failure', 'install_prompt_failure', 'transport_policy_violation', 'auth_operator', 'configuration_generated']);
const CODES = new Set(['LOG_EVENT', 'INTERNAL_ERROR', 'UPSTREAM_CIRCUIT_OPEN', 'UPSTREAM_INVALID_RESPONSE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_HTTP_ERROR', 'UPSTREAM_FAILURE',
  'NOTIFICATION_FAILED', 'AUTH_UNAVAILABLE', 'AUTH_EVENT', 'RATE_LIMIT_ALLOWED', 'RATE_LIMITED', 'RATE_LIMIT_UNAVAILABLE', 'USER_CONTEXT_UNAVAILABLE',
  'QUEUE_FULL', 'JOB_EXPIRED', 'JOB_FAILED', 'INSTALL_PROMPT_FAILED', 'INSECURE_RESOURCE', 'AUTH_BOOTSTRAP_FAILED', 'AUTH_MIGRATION_FAILED', 'ENV_EXAMPLE_GENERATED']);
const ENUMS: Record<string, readonly string[]> = {
  scope: ['api', 'page', 'app', 'auth', 'script'], service: ['lta', 'nea', 'camera', 'gateway', 'vehicle'],
  source: ['psi', 'pm25', 'lightning', 'wbgt', 'roadworks', 'faulty_lights'],
  operation: ['permission', 'delivery', 'auth_migration', 'auth_postgres_smoke', 'auth_preview_smoke', 'auth_database_task', 'account_created'],
  mechanism: ['react_boundary', 'react_uncaught', 'react_recoverable', 'window_error', 'unhandled_rejection'],
  outcome: ['limited', 'unavailable'], lane: ['analysis', 'history', 'notifications'], scheme: ['http', 'ws'],
  directive: ['default-src', 'script-src', 'script-src-elem', 'style-src', 'style-src-elem', 'img-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'media-src', 'object-src', 'form-action', 'resource'],
  status: ['success', 'failed'], exceptionType: ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'TimeoutError', 'AbortError', 'unknown'],
};
const BOOLEAN_FIELDS = ['passwordVerified', 'secureCookie', 'sharedSession', 'logoutRevoked', 'signIn', 'sessionRead', 'accountAdmissionTraversed', 'quotaEnforced'];
const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let minimum: LogLevel = 'info';
let contextProvider: () => ErrorContext = () => ({});

export function setLogLevel(level: LogLevel) {
  const previous = minimum; minimum = LOG_LEVELS.includes(level) ? level : 'info';
  return () => { minimum = previous; };
}
export function installLogContext(provider: () => ErrorContext) {
  const previous = contextProvider; contextProvider = provider;
  return () => { contextProvider = previous; };
}

/** One JSON object per line. Free text, arbitrary objects and reserved-field overrides are never serialized. */
export function writeLog(level: Exclude<LogLevel, 'silent'>, input: Record<string, unknown>, options: { context?: ErrorContext } = {}) {
  level = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
  if (priorities[level] < priorities[minimum]) return;
  const fields: Record<string, unknown> = {};
  let context: ReturnType<typeof safeContext>;
  try { context = safeContext(options.context ?? contextProvider()); } catch { context = safeContext({}); }
  let event = 'application_log';
  try {
    // Ignore accessors entirely. Do not call getters/toJSON on a submitted log object.
    const value = (key: string): unknown => { const descriptor = Object.getOwnPropertyDescriptor(input, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; };
    const submittedEvent = value('event'), code = value('code');
    if (typeof submittedEvent === 'string' && EVENTS.has(submittedEvent)) event = submittedEvent;
    if (typeof code === 'string' && CODES.has(code)) fields.code = code;
    for (const [key, values] of Object.entries(ENUMS)) {
      const field = value(key); if (typeof field === 'string' && values.includes(field)) fields[key] = field;
    }
    const id = value('errorId'); if (isErrorId(id)) fields.errorId = id;
    const release = value('clientRelease'); if (release === 'unknown' || safeRelease(release) !== 'unknown') fields.clientRelease = safeRelease(release);
    const httpCode = value('upstreamHttpCode');
    if (Number.isInteger(httpCode) && Number(httpCode) >= 100 && Number(httpCode) <= 599) fields.upstreamHttpCode = httpCode;
    for (const key of ['tablesCreated', 'columnsAdded']) {
      const n = value(key); if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000) fields[key] = n;
    }
    for (const key of BOOLEAN_FIELDS) { const field = value(key); if (typeof field === 'boolean') fields[key] = field; }
    const rawLocations = value('locations');
    if (Array.isArray(rawLocations)) fields.locations = rawLocations.slice(0, 3).flatMap(location => {
      const line = location?.line, column = location?.column;
      return [line, column].every(n => Number.isInteger(n) && n >= 0 && n <= 9_999_999) ? [{ line, column }] : [];
    });
  } catch { /* A bad diagnostic field must not escape the reporting path. */ }
  if (fields.errorId) fields.fingerprint = [event, fields.code ?? 'LOG_EVENT', context.route, context.page, fields.exceptionType ?? 'unknown',
    ...((fields.locations ?? []) as {line: number; column: number}[]).map(location => `${location.line}:${location.column}`)].join(':');
  const record = { schemaVersion: 1, timestamp: new Date().toISOString(), level, event, ...fields, context };
  try { console[level](JSON.stringify(record)); } catch { /* Log sinks never change business responses. */ }
  return record;
}
export const logger = {
  debug: (input: Record<string, unknown>) => writeLog('debug', input),
  info: (input: Record<string, unknown>) => writeLog('info', input),
  warn: (input: Record<string, unknown>) => writeLog('warn', input),
  error: (input: Record<string, unknown>) => writeLog('error', input),
};
