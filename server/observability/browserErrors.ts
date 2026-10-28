import { ERROR_TRACKING } from '../../config/policy.ts';
import { captureBrowserReport, validateBrowserReport, type BrowserErrorReport } from '../../shared/errorTracking.ts';
import { reportApplicationFailure } from '../../shared/applicationDiagnostics.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';
import { corsHeaders, setNodeCors, setWebCors } from '../http/cors.ts';
import { headerValues, queryValues, RequestValidationError } from '../http/requestSchemas.ts';
import { publicRateLimitGuard, RateLimitRejection } from '../http/rateLimit.ts';
import { sendJson } from '../http/responses.ts';
import { currentErrorContext, withErrorContext } from './context.ts';

const NO_STORE = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' };
class RejectedReport extends Error { constructor(readonly status: number) { super('Invalid error report'); } }

/** Select only this dispatcher operation; its handler still validates the entire route/query. */
export function isErrorTransport(req: any) {
  try { return new URL(req.url, 'https://request.invalid').searchParams.getAll('feed').includes('errors') ||
    req.query?.feed === 'errors' || (Array.isArray(req.query?.feed) && req.query.feed.includes('errors')); }
  catch { return false; }
}

function oneHeader(req: any, name: string) {
  const values = headerValues(req, name);
  const raw: unknown[] = [];
  if (Array.isArray(req.rawHeaders)) for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (String(req.rawHeaders[i]).toLowerCase() === name) raw.push(req.rawHeaders[i + 1]);
  if (values.length > 1 || raw.length > 1 || (raw.length === 1 && (values.length !== 1 || raw[0] !== values[0]))) throw new RejectedReport(400);
  return values[0];
}

async function readReport(req: any): Promise<BrowserErrorReport> {
  const chunks: Uint8Array[] = []; let bytes = 0;
  const add = (chunk: Uint8Array) => {
    bytes += chunk.byteLength;
    if (bytes > ERROR_TRACKING.bodyBytes) throw new RejectedReport(413);
    chunks.push(chunk);
  };
  if (req instanceof Request) {
    await withRequestDeadline(ERROR_TRACKING.timeoutMs, async signal => {
      const reader = req.body?.getReader();
      if (!reader) throw new RejectedReport(400);
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) { const item = await reader.read(); signal.throwIfAborted(); if (item.done) break; add(item.value); }
      } catch (error) { cancel(); throw error; }
      finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    }, req.signal);
  } else if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) add(req.body);
    else if (typeof req.body === 'string') add(Buffer.from(req.body));
    else {
      const report = validateBrowserReport(req.body);
      if (!report) throw new RejectedReport(400);
      add(Buffer.from(JSON.stringify(report)));
    }
  } else {
    await withRequestDeadline(ERROR_TRACKING.timeoutMs, signal => new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => {
        req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', fail);
        req.removeListener('aborted', fail); signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const data = (chunk: Buffer) => { try { add(chunk); } catch (error) { req.pause(); done(error); } };
      const end = () => done(); const fail = () => done(new RejectedReport(400));
      const abort = () => { req.pause(); done(new RejectedReport(408)); };
      req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', fail);
      signal.addEventListener('abort', abort, { once: true });
    }));
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RejectedReport(400); }
  const report = validateBrowserReport(value);
  if (!report) throw new RejectedReport(400);
  return report;
}

export function createBrowserErrorHandler(options: {
  admit?: typeof publicRateLimitGuard; now?: () => number;
  capture?: (report: BrowserErrorReport) => void;
} = {}) {
  let windowStart = 0, accepted = 0;
  const handler = async (req: any, res?: any) => {
    let cors: Record<string, string> = { Vary: 'Origin' };
    const send = (status: number, body: unknown, extra = {}) => {
      setNodeCors(res, cors);
      return setWebCors(sendJson(res, status, body, { ...NO_STORE, ...extra }), cors);
    };
    try {
      const query = queryValues(req);
      const url = new URL(req.url, 'https://request.invalid');
      if (url.pathname !== '/api/live' || query.size !== 1 || query.get('feed') !== 'errors') throw new RejectedReport(400);
      if (req.method !== 'POST') return send(405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' }, { Allow: 'POST' });
      cors = corsHeaders(req);
      const site = oneHeader(req, 'sec-fetch-site');
      if (!oneHeader(req, 'origin') || (site !== undefined && !['same-origin', 'same-site', 'none'].includes(site))) throw new RejectedReport(403);
      if (oneHeader(req, 'content-encoding') || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(oneHeader(req, 'content-type') ?? '')) throw new RejectedReport(415);
      const length = oneHeader(req, 'content-length');
      if (length !== undefined && (!/^(0|[1-9]\d{0,6})$/.test(length) || Number(length) > ERROR_TRACKING.bodyBytes)) throw new RejectedReport(413);
      const report = await readReport(req);
      return await (options.admit ?? publicRateLimitGuard).run(req, async () => {
        const now = (options.now ?? Date.now)();
        if (now - windowStart >= ERROR_TRACKING.windowMs) { windowStart = now; accepted = 0; }
        if (accepted >= ERROR_TRACKING.instanceBudget) return send(429, { success: false, code: 'REPORT_LIMITED', error: 'Please try again later.' }, { 'Retry-After': '60' });
        accepted++;
        (options.capture ?? (report => captureBrowserReport(report, currentErrorContext())))(report);
        return send(202, { success: true, errorId: report.errorId });
      });
    } catch (error) {
      const status = error instanceof RejectedReport || error instanceof RequestValidationError ? error.status :
        error instanceof RateLimitRejection ? error.status : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 408 : 500;
      return send(status, status === 500 ? reportApplicationFailure('api', error) :
        { success: false, code: status === 429 ? 'REPORT_LIMITED' : 'INVALID_ERROR_REPORT', error: 'Unable to accept error report.' },
        error instanceof RateLimitRejection ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  };
  return (req: any, res?: any) => withErrorContext(req, () => handler(req, res));
}

export const browserErrorHandler = createBrowserErrorHandler();
