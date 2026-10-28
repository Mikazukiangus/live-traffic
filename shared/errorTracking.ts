import { ERROR_TRACKING } from '../config/policy.ts';

const SCOPES = ['api', 'page', 'app', 'auth'] as const;
const PAGES = ['cameras', 'radar', 'sos', 'courier', 'unknown'] as const;
export const ERROR_MECHANISMS = ['react_boundary', 'react_uncaught', 'react_recoverable', 'window_error', 'unhandled_rejection'] as const;
const TYPES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'TimeoutError', 'AbortError', 'unknown'] as const;
const ROUTES = ['traffic', 'trafficimages', 'trafficflow', 'vms', 'traveltimes', 'expresswayspeeds', 'rainforecast', 'forecast24h', 'airquality', 'health', 'imageproxy', 'live', 'carparks', 'roadconditions', 'weatheralerts', 'floods', 'auth', 'errors', 'unknown'] as const;
const EVENTS = ['upstream_failure', 'application_failure', 'notification_failure', 'auth_storage_failure', 'authentication_unavailable', 'authentication_event', 'client_exception'] as const;
const CODES = ['INTERNAL_ERROR', 'UPSTREAM_CIRCUIT_OPEN', 'UPSTREAM_INVALID_RESPONSE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_HTTP_ERROR', 'UPSTREAM_FAILURE', 'NOTIFICATION_FAILED', 'AUTH_UNAVAILABLE', 'AUTH_EVENT'] as const;
const SERVICES = ['lta', 'nea', 'camera', 'gateway', 'vehicle'] as const;
const SOURCES = ['psi', 'pm25', 'lightning', 'wbgt', 'roadworks', 'faulty_lights'] as const;
const member = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const newErrorId = () => globalThis.crypto.randomUUID();
export const safeRelease = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : 'unknown';
export const safePage = (value: unknown) => member(PAGES, value) ? value : 'unknown';
export const safeRoute = (value: unknown) => member(ROUTES, value) ? value : 'unknown';
type Location = { line: number; column: number };
export type ErrorContext = { requestId?: string; route?: string; method?: string; release?: string; environment?: string; page?: string };
export type Diagnostic = { event: string; code: string; scope?: string; service?: string; source?: string; operation?: string; mechanism?: string; upstreamHttpCode?: number };
export type TrackedError = ReturnType<typeof createTrackedError>;

/** Inspect only fixed type and numeric coordinates. Never read message/cause/props or serialize an Error. */
export function exceptionDetails(error: unknown): { exceptionType: typeof TYPES[number]; locations: Location[] } {
  let exceptionType: typeof TYPES[number] = 'unknown';
  const locations: Location[] = [];
  try {
    if (error instanceof Error) {
      const name = error.name;
      if (member(TYPES, name)) exceptionType = name;
      const stack = error.stack;
      if (typeof stack === 'string') {
        // Skip the message line. Filenames, function names, origins and queries never leave this function.
        for (const line of stack.slice(0, 8192).split('\n').slice(1, 12)) {
          const match = /:(\d{1,7}):(\d{1,7})\)?$/.exec(line);
          if (match && locations.length < ERROR_TRACKING.maxLocations)
            locations.push({ line: Number(match[1]), column: Number(match[2]) });
        }
      }
    }
  } catch { /* Hostile getters/proxies must not turn reporting into another exception. */ }
  return { exceptionType, locations };
}

function safeContext(input: ErrorContext) {
  return {
    ...(uuid(input.requestId) ? { requestId: input.requestId } : {}),
    route: safeRoute(input.route),
    method: member(['GET', 'POST', 'OPTIONS'] as const, input.method) ? input.method : 'unknown',
    release: safeRelease(input.release),
    environment: member(['production', 'preview', 'development', 'test'] as const, input.environment) ? input.environment : 'development',
    page: safePage(input.page),
  };
}

function createTrackedError(diagnostic: Diagnostic, details: ReturnType<typeof exceptionDetails>, context: ErrorContext, errorId: string = newErrorId()) {
  const event = member(EVENTS, diagnostic.event) ? diagnostic.event : 'application_failure';
  const code = member(CODES, diagnostic.code) ? diagnostic.code : 'INTERNAL_ERROR';
  return { event, code, errorId, timestamp: new Date().toISOString(),
    ...(member(SCOPES, diagnostic.scope) ? { scope: diagnostic.scope } : {}),
    ...(member(SERVICES, diagnostic.service) ? { service: diagnostic.service } : {}),
    ...(member(SOURCES, diagnostic.source) ? { source: diagnostic.source } : {}),
    ...(member(['permission', 'delivery'] as const, diagnostic.operation) ? { operation: diagnostic.operation } : {}),
    ...(member(ERROR_MECHANISMS, diagnostic.mechanism) ? { mechanism: diagnostic.mechanism } : {}),
    ...(Number.isInteger(diagnostic.upstreamHttpCode) && diagnostic.upstreamHttpCode! >= 100 && diagnostic.upstreamHttpCode! <= 599
      ? { upstreamHttpCode: diagnostic.upstreamHttpCode } : {}),
    ...details, context: safeContext(context),
    // A bounded grouping key, not a hash of a raw exception or user input.
    fingerprint: [event, code, safeRoute(context.route), safePage(context.page), details.exceptionType,
      ...details.locations.map(location => `${location.line}:${location.column}`)].join(':'),
  };
}

let contextProvider: () => ErrorContext = () => ({});
let transport: ((event: TrackedError) => string | void) | undefined;
/** Install once per runtime; request context must be provided by AsyncLocalStorage, never a mutable request global. */
export function installErrorTracking(options: { context: () => ErrorContext; transport?: (event: TrackedError) => string | void }) {
  const previous = { contextProvider, transport };
  contextProvider = options.context; transport = options.transport;
  return () => { contextProvider = previous.contextProvider; transport = previous.transport; };
}

function emit(event: TrackedError & { clientRelease?: string }, warning: boolean) {
  try {
    const existing = transport?.(event);
    // A deduplicated browser occurrence keeps the reference that was actually submitted.
    if (uuid(existing)) event.errorId = existing;
  } catch { /* No recursive telemetry for telemetry failures. */ }
  try { (warning ? console.warn : console.error)(JSON.stringify(event)); } catch { /* Logging must not break recovery. */ }
  return event;
}

export function captureException(diagnostic: Diagnostic, error?: unknown, warning = false) {
  let context: ErrorContext = {};
  try { context = contextProvider(); } catch { /* Retain a minimal event if context is unavailable. */ }
  return emit(createTrackedError(diagnostic, exceptionDetails(error), context), warning);
}

export interface BrowserErrorReport {
  version: 1; errorId: string; scope: 'app' | 'page'; mechanism: typeof ERROR_MECHANISMS[number];
  page: typeof PAGES[number]; release: string; exceptionType: typeof TYPES[number]; locations: Location[];
}
/** The public ingestion schema rejects free text and extra fields, even if a client bypasses our reporter. */
export function validateBrowserReport(value: unknown): BrowserErrorReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = ['version', 'errorId', 'scope', 'mechanism', 'page', 'release', 'exceptionType', 'locations'];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) || v.version !== 1 || !uuid(v.errorId) ||
    !member(['app', 'page'] as const, v.scope) || !member(ERROR_MECHANISMS, v.mechanism) || !member(PAGES, v.page) ||
    (v.release !== 'unknown' && safeRelease(v.release) !== v.release) || !member(TYPES, v.exceptionType) ||
    !Array.isArray(v.locations) || v.locations.length > ERROR_TRACKING.maxLocations) return null;
  for (const location of v.locations) {
    if (!location || typeof location !== 'object' || Array.isArray(location) || Object.keys(location).length !== 2 ||
      Object.keys(location).some(key => key !== 'line' && key !== 'column') ||
      ![location.line, location.column].every(n => Number.isInteger(n) && n >= 0 && n <= 9_999_999)) return null;
  }
  return v as unknown as BrowserErrorReport;
}

/** Browser fields are explicitly client-reported; receipt context is generated separately by the server. */
export function captureBrowserReport(report: BrowserErrorReport, receipt: ErrorContext) {
  return emit({ ...createTrackedError({ event: 'client_exception', code: 'INTERNAL_ERROR', scope: report.scope, mechanism: report.mechanism },
    { exceptionType: report.exceptionType, locations: report.locations }, { ...receipt, page: report.page }, report.errorId),
    clientRelease: safeRelease(report.release) }, false);
}
