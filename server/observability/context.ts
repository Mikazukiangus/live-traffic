import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import { config } from '../../config/server.ts';
import { installErrorTracking, newErrorId, safeRoute, type ErrorContext } from '../../shared/errorTracking.ts';
import { logger, setLogLevel } from '../../shared/logging.ts';
export { logger } from '../../shared/logging.ts';

const requests = new AsyncLocalStorage<{ request: object; context: ErrorContext; userResolved: boolean; userPending?: Promise<void> }>();
setLogLevel(config.server.logging.level);
installErrorTracking({ context: () => ({ ...config.errorTracking, ...requests.getStore()?.context }) });

export function currentErrorContext(): ErrorContext {
  return { ...config.errorTracking, ...requests.getStore()?.context };
}

/** Only call with an ID returned by the server-side session verifier, never req.user/header/body. */
export function setVerifiedLogUser(id: string, secret: string | null = config.server.auth.secret) {
  const state = requests.getStore(); if (!state) return;
  state.userResolved = true;
  if (!secret || secret.length < 32 || typeof id !== 'string' || !id || id.length > 512) {
    state.context.user = { status: 'unavailable' }; return;
  }
  try {
    const digest = createHmac('sha256', secret).update(JSON.stringify(['trafficpulse-log-user-v1', config.errorTracking.environment, id])).digest('hex');
    state.context.user = { status: 'authenticated', id: digest };
  } catch { state.context.user = { status: 'unavailable' }; }
}

export function setAnonymousLogUser() {
  const state = requests.getStore(); if (!state) return;
  state.context.user = { status: 'anonymous' }; state.userResolved = true;
}

/** One optional lookup per actual request, including nested live dispatch; logging never changes admission. */
export async function resolveLogUserOnce(req: object, resolve: () => Promise<void>) {
  const state = requests.getStore();
  if (!state || state.request !== req || state.userResolved) return;
  if (!state.userPending) state.userPending = Promise.resolve().then(resolve).catch(() => {
    state.context.user = { status: 'unavailable' };
    logger.warn({ event: 'request_user_context', code: 'USER_CONTEXT_UNAVAILABLE' });
  }).finally(() => { state.userResolved = true; });
  await state.userPending;
}

/** Route labels come from a closed vocabulary. Never trust incoming request/correlation IDs. */
export function withErrorContext<T>(req: any, run: () => T): T {
  if (requests.getStore()?.request === req) return run();
  let route = 'unknown';
  try {
    const url = new URL(req.url, config.siteUrl);
    route = url.pathname.startsWith('/api/auth/') ? 'auth' : safeRoute(url.pathname.replace(/^\/api\/_?/, ''));
    if (route === 'live') {
      const feed = url.searchParams.get('feed') ?? req.query?.feed;
      if (['carparks', 'roadconditions', 'weatheralerts', 'floods', 'forecast24h', 'errors'].includes(feed)) route = feed;
    }
  } catch { /* Only a fixed unknown route is retained for malformed requests. */ }
  const context: ErrorContext = { requestId: newErrorId(), route, method: req?.method, user: { status: 'unverified' } };
  return requests.run({ request: req, context, userResolved: false }, run);
}
