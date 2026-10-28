import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { logger, setLogLevel, installLogContext } from '../shared/logging.ts';
import { reportApplicationFailure } from '../shared/applicationDiagnostics.ts';
import { withErrorContext, currentErrorContext, setVerifiedLogUser } from '../server/observability/context.ts';
import { createLogUserResolver } from '../server/observability/userContext.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { createAuthService } from '../server/auth/service.ts';
import { createAuthHandler } from '../server/auth/handler.ts';
import { config } from '../config/server.ts';
import { createApiMiddleware } from '../server/apiMiddleware.ts';

const marker = 'synthetic-private-log-marker';
const key = 'synthetic-logging-HMAC-key-longer-than-32-characters';
const tick = () => new Promise(resolve => setImmediate(resolve));
const expectedUser = (id: string, secret = key) => createHmac('sha256', secret)
  .update(JSON.stringify(['trafficpulse-log-user-v1', config.errorTracking.environment, id])).digest('hex');
async function capture(run: (events: any[]) => Promise<void> | void) {
  const before = { debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  const events: any[] = [];
  console.debug = console.info = console.warn = console.error = value => { events.push(JSON.parse(value)); };
  try { await run(events); } finally { Object.assign(console, before); }
}
function req(cookie?: string, url = '/api/traffic') {
  return new Request('https://fixture.test' + url, { headers: { ...(cookie ? { cookie } : {}),
    'x-user-id': marker, 'x-request-id': marker, Authorization: marker } });
}

test('all application levels and exception events share one versioned JSON envelope and automatic context', async () => {
  await capture(async events => {
    const restore = setLogLevel('debug');
    try {
      await withErrorContext(req(), async () => {
        logger.debug({ event: 'application_log' }); logger.info({ event: 'application_log' });
        await tick(); logger.warn({ event: 'api_rate_limit', outcome: 'limited' });
        reportApplicationFailure('api', new TypeError(marker));
      });
      assert.deepEqual(events.map(event => event.level), ['debug', 'info', 'warn', 'error']);
      assert.equal(new Set(events.map(event => event.context.requestId)).size, 1);
      for (const event of events) {
        assert.equal(event.schemaVersion, 1); assert.equal(event.context.route, 'traffic');
        assert.equal(event.context.method, 'GET'); assert.ok(Number.isFinite(Date.parse(event.timestamp)));
        assert.ok(!JSON.stringify(event).includes(marker));
      }
    } finally { restore(); }
  });
});

test('logger projects allowed fields only, ignores accessors/free text and cannot overwrite automatic context', async () => {
  await capture(events => {
    let invoked = false;
    const input: any = { event: 'application_log', message: marker, stack: marker, cause: marker,
      timestamp: marker, level: marker, context: { requestId: marker, user: { id: marker } }, cookie: marker,
      toJSON() { throw new Error(marker); } };
    Object.defineProperty(input, 'code', { get() { invoked = true; throw new Error(marker); } });
    logger.info(input);
    assert.equal(invoked, false); assert.equal(events.length, 1); assert.ok(!JSON.stringify(events).includes(marker));
    const restore = installLogContext(() => Object.defineProperty({}, 'requestId', { get() { throw new Error(marker); } }));
    try { assert.doesNotThrow(() => logger.error(input)); } finally { restore(); }
    assert.ok(!JSON.stringify(events).includes(marker));
  });
});

test('validated level thresholds filter without changing error responses or browser configuration', async () => {
  await capture(events => {
    const restore = setLogLevel('error');
    try { logger.debug({ event: 'application_log' }); logger.info({ event: 'application_log' }); logger.warn({ event: 'application_log' });
      const response = reportApplicationFailure('api'); assert.equal(response.code, 'INTERNAL_ERROR'); assert.equal(events.length, 1);
      const silent = setLogLevel('silent'); try { reportApplicationFailure('api'); assert.equal(events.length, 1); } finally { silent(); }
    } finally { restore(); }
    assert.equal(createConfig().server.logging.level, 'info');
    assert.equal(createConfig({ LOG_LEVEL: 'warn', LOG_USER_CONTEXT_TIMEOUT_MS: '250' }).server.logging.userContextTimeoutMs, 250);
    for (const env of [{ LOG_LEVEL: marker }, { LOG_USER_CONTEXT_TIMEOUT_MS: '99' }, { LOG_USER_CONTEXT_TIMEOUT_MS: '5001' }]) {
      assert.throws(() => createConfig(env), error => error instanceof Error && !error.message.includes(marker));
    }
    const browser = createPublicConfig({ LOG_LEVEL: 'debug', LOG_USER_CONTEXT_TIMEOUT_MS: '500' });
    assert.ok(!('logging' in browser)); assert.ok(!JSON.stringify(browser).includes('userContextTimeoutMs'));
  });
});

test('verified user context is HMAC-pseudonymous, stable across requests and isolated between concurrent users', async () => {
  await capture(async events => {
    let calls = 0;
    const resolve = createLogUserResolver({ enabled: true, secret: key, timeoutMs: 1000, verify: async headers => {
      calls++; await tick(); return { user: { id: headers.get('cookie')!.includes('alpha') ? 'private-alpha' : 'private-beta' } };
    } });
    await Promise.all(['alpha', 'beta', 'alpha'].map(async user => {
      const request = req('trafficpulse.session_token=' + user);
      await withErrorContext(request, async () => {
        await Promise.all([resolve(request), resolve(request)]);
        await withErrorContext(request, async () => { await resolve(request); await tick(); logger.info({ event: 'application_log' }); });
      });
    }));
    assert.equal(calls, 3); assert.equal(events.length, 3);
    assert.equal(new Set(events.map(event => event.context.requestId)).size, 3);
    assert.deepEqual(events.map(event => event.context.user.id).sort(), [expectedUser('private-alpha'), expectedUser('private-alpha'), expectedUser('private-beta')].sort());
    assert.ok(events.every(event => event.context.user.status === 'authenticated'));
    assert.ok(!JSON.stringify(events).includes('private-alpha')); assert.ok(!JSON.stringify(events).includes('private-beta'));
    assert.ok(!JSON.stringify(events).includes(marker)); assert.ok(!JSON.stringify(events).includes(key));
    await withErrorContext(req(), () => { setVerifiedLogUser('private-alpha', key + '-rotated'); logger.info({ event: 'application_log' }); });
    assert.notEqual(events.at(-1).context.user.id, expectedUser('private-alpha'));
  });
});

test('forged identities, absent/revoked sessions and disabled login stay anonymous without account lookup', async () => {
  await capture(async events => {
    let calls = 0;
    for (const [enabled, cookie] of [[true, undefined], [false, 'trafficpulse.session_token=forged'], [true, 'userId=forged']] as const) {
      const resolve = createLogUserResolver({ enabled, secret: key, timeoutMs: 1000, verify: async () => { calls++; throw new Error(marker); } });
      const request = req(cookie, '/api/traffic?userId=' + marker);
      await withErrorContext(request, async () => { await resolve(request); logger.info({ event: 'application_log' }); });
    }
    assert.equal(calls, 0);
    const revoked = createLogUserResolver({ enabled: true, secret: key, timeoutMs: 1000, verify: async () => { calls++; return null; } });
    const request = req('trafficpulse.session_token=expired');
    await withErrorContext(request, async () => { await revoked(request); logger.info({ event: 'application_log' }); });
    assert.equal(calls, 1); assert.ok(events.every(event => event.context.user.status === 'anonymous' && !('id' in event.context.user)));
  });
});

test('identity failure and timeout do not block public business logic or mutate identity after late completion', async () => {
  await capture(async events => {
    let complete!: (value: { user: { id: string } }) => void;
    const resolve = createLogUserResolver({ enabled: true, secret: key, timeoutMs: 15, verify: () => new Promise(done => { complete = done; }) });
    const handler = withRequestSchema(requestSchemas.empty, async () => {
      logger.info({ event: 'application_log' }); return Response.json({ success: true });
    }, { logUser: resolve });
    const response = await handler(req('trafficpulse.session_token=slow')) as Response;
    assert.equal(response.status, 200); assert.equal(events.at(-1).context.user.status, 'unavailable');
    complete({ user: { id: 'private-late' } }); await tick();
    assert.ok(events.every(event => event.context.user.status !== 'authenticated'));
    assert.equal(events.filter(event => event.code === 'USER_CONTEXT_UNAVAILABLE').length, 1);
    assert.ok(!JSON.stringify(events).includes('private-late'));
  });
});

test('request validation/preflight precedes identity lookup, and errors carry user context only in logs', async () => {
  await capture(async events => {
    let calls = 0;
    const resolve = createLogUserResolver({ enabled: true, secret: key, timeoutMs: 1000, verify: async () => { calls++; return { user: { id: 'private-actor' } }; } });
    const handler = withRequestSchema(requestSchemas.empty, async () => { throw new TypeError(marker); }, { logUser: resolve });
    const malformed = await handler(req('trafficpulse.session_token=valid', '/api/traffic?unknown=1')) as Response;
    assert.equal(malformed.status, 400);
    const preflight = await handler(new Request('https://fixture.test/api/traffic', { method: 'OPTIONS' })) as Response;
    assert.equal(preflight.status, 204); assert.equal(calls, 0);
    const failure = await handler(req('trafficpulse.session_token=valid')) as Response;
    const body = await failure.json(); assert.equal(failure.status, 500); assert.equal(body.error, 'Something went wrong. Please try again.');
    const log = events.find(event => event.errorId === body.errorId);
    assert.equal(log.context.user.id, expectedUser('private-actor')); assert.ok(!JSON.stringify(body).includes(log.context.user.id));
    assert.ok(!JSON.stringify([events, body]).includes(marker));
  });
});

test('real Better Auth signed sessions provide log identity; unsigned and revoked cookies cannot impersonate it', async () => {
  await capture(async events => {
    const db = new DatabaseSync(':memory:');
    try {
      const service = createAuthService({ database: db, secret: key, origin: 'https://fixture.test', secureCookies: true, allowEnrollment: true });
      await (await getMigrations(service.options)).runMigrations();
      await service.api.signUpEmail({ body: { name: 'Synthetic', email: 'logging@example.test', password: 'Synthetic-logging-password-123' } });
      // Enrollment intentionally does not sign in. Exercise the actual credential/session flow.
      const signedIn = await service.api.signInEmail({ body: { email: 'logging@example.test', password: 'Synthetic-logging-password-123' }, asResponse: true });
      assert.equal(signedIn.status, 200);
      const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      assert.ok(cookie.length > 0);
      const resolve = createLogUserResolver({ enabled: true, secret: key, timeoutMs: 1000, verify: headers => service.api.getSession({ headers, query: { disableCookieCache: true } }) });
      const realSession = await service.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
      assert.ok(realSession?.user.id);
      const log = async (value: string) => { const request = req(value); await withErrorContext(request, async () => { await resolve(request); logger.info({ event: 'application_log' }); }); };
      await log(cookie); assert.equal(events.at(-1).context.user.id, expectedUser(realSession.user.id));
      const unavailable = createAuthHandler({ origin: 'https://fixture.test', origins: ['https://fixture.test'], logIdentitySecret: key,
        clientIp: () => '203.0.113.8', service: () => ({ ...service, handler: async () => { throw new TypeError(marker); } }) });
      const failure = await unavailable(new Request('https://fixture.test/api/auth/sign-out', { method: 'POST',
        headers: { Origin: 'https://fixture.test', 'Content-Type': 'application/json', cookie }, body: '{}' })) as Response;
      const failureBody = await failure.json(); assert.equal(failure.status, 503);
      assert.equal(events.find(event => event.errorId === failureBody.errorId).context.user.id, expectedUser(realSession.user.id));
      assert.ok(!JSON.stringify(failureBody).includes(expectedUser(realSession.user.id)));
      await log('__Secure-trafficpulse.session_token=forged'); assert.equal(events.at(-1).context.user.status, 'anonymous');
      await service.api.signOut({ headers: new Headers({ cookie }) });
      await log(cookie); assert.equal(events.at(-1).context.user.status, 'anonymous');
      assert.ok(!JSON.stringify(events).includes(cookie)); assert.ok(!JSON.stringify(events).includes(realSession.user.id));
    } finally { db.close(); }
  });
});

test('ambiguous Node cookie inputs fail enrichment safely, and identities never persist outside a request', async () => {
  await capture(async events => {
    let calls = 0;
    const resolve = createLogUserResolver({ enabled: true, secret: key, timeoutMs: 1000, verify: async () => { calls++; return null; } });
    const request = { url: '/api/traffic', method: 'GET', headers: { cookie: 'trafficpulse.session_token=one' }, rawHeaders: ['Cookie', 'trafficpulse.session_token=other'] };
    await withErrorContext(request, async () => { await resolve(request); logger.warn({ event: 'application_log' }); });
    assert.equal(calls, 0); assert.equal(events.at(-1).context.user.status, 'unavailable');
    assert.equal(currentErrorContext().user, undefined);
  });
});

test('dev/preview loader failures receive request context before an API handler can initialize', async () => {
  await capture(async events => {
    const middleware = createApiMiddleware({ '/api/vms': async () => { throw new TypeError(marker); } });
    let body = '';
    const res = { statusCode: 0, setHeader() {}, end(value: string) { body = value; } };
    await middleware({ url: '/api/vms', method: 'GET', headers: {} }, res, () => assert.fail('unexpected fallthrough'));
    assert.equal(res.statusCode, 500); assert.equal(events.length, 1);
    assert.equal(events[0].context.route, 'vms'); assert.match(events[0].context.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(events[0].context.user.status, 'unverified'); assert.ok(!body.includes(marker));
  });
});

test('runtime console logging stays centralized; machine-readable CLI outputs and prompts are separate contracts', async () => {
  const findings: string[] = [];
  const walk = async (relative: string) => {
    for (const entry of await readdir(new URL('../' + relative + '/', import.meta.url), { withFileTypes: true })) {
      const file = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(file) && file !== 'shared/logging.ts' && /console\s*(?:\.|\[)/.test(await readFile(new URL('../' + file, import.meta.url), 'utf8'))) findings.push(file);
    }
  };
  for (const directory of ['api', 'server', 'shared', 'src', 'config']) await walk(directory);
  assert.deepEqual(findings, []);
});
