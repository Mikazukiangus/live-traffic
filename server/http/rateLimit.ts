import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { checkRateLimit } from '@vercel/firewall';
import { config } from '../../config/server.ts';
import { API_RATE_LIMITS } from '../../config/rateLimitPolicy.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';

type Settings = typeof config.server.rateLimit;
type CheckInput = { id: string; key: string; ip: string; host: string; timeoutMs: number };
export type RateLimitCheck = (input: CheckInput) => Promise<{ rateLimited: boolean; error?: string }>;
type Observer = (outcome: 'limited' | 'unavailable') => void;

/** Fixed error content; never keep identities, addresses, provider errors or URLs. */
export class RateLimitRejection extends Error {
  constructor(readonly status: 429 | 503) { super('API admission rejected'); }
  get code() { return this.status === 429 ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE'; }
  get retryAfter() { return this.status === 429 ? API_RATE_LIMITS.windowSeconds : 5; }
}

/** Trust this header only when server-owned VERCEL metadata confirms the platform. */
export function platformClientIp(req: any): string {
  let value: unknown;
  if (req?.headers instanceof Headers) value = req.headers.get('x-real-ip');
  else {
    const entries = Object.entries(req?.headers ?? {}).filter(([name]) => name.toLowerCase() === 'x-real-ip');
    if (entries.length !== 1) throw new RateLimitRejection(503);
    value = entries[0][1];
  }
  if (Array.isArray(req?.rawHeaders)) {
    const values: unknown[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (String(req.rawHeaders[i]).toLowerCase() === 'x-real-ip') values.push(req.rawHeaders[i + 1]);
    if (values.length !== 1 || values[0] !== value) throw new RateLimitRejection(503);
  }
  if (typeof value !== 'string' || value.length > 64 || value.includes('%') || !isIP(value)) throw new RateLimitRejection(503);
  const address = ipaddr.process(value); // IPv4-mapped IPv6 must share the IPv4 bucket.
  if (address.kind() === 'ipv4') return address.toString();
  // IPv6 privacy addresses in one /64 share a bucket, rather than permitting suffix rotation.
  const bytes = address.toByteArray();
  bytes.fill(0, 8);
  return ipaddr.fromByteArray(bytes).toString();
}

export const vercelRateLimitCheck: RateLimitCheck = async ({ id, key, ip, host, timeoutMs }) => {
  // The SDK otherwise silently allows requests outside production mode.
  if (process.env.NODE_ENV !== 'production') throw new RateLimitRejection(503);
  // SDK derives its outbound host from headers. NEVER pass the incoming headers/request:
  // that would forward credentials, signed URL query data, and a potentially hostile Host.
  const result = await checkRateLimit(id, {
    headers: new Headers({ host, 'x-real-ip': ip, 'x-forwarded-for': ip }),
    rateLimitKey: key, timeout: timeoutMs,
  });
  return result;
};

function bucket(namespace: string, dimension: 'ip' | 'user', identity: string): string {
  return createHash('sha256').update(JSON.stringify(['trafficpulse-v1', namespace, dimension, identity])).digest('hex');
}

function createObserver(): Observer {
  const next = { limited: 0, unavailable: 0 };
  return (outcome) => {
    const now = Date.now();
    if (now < next[outcome]) return;
    next[outcome] = now + 60_000;
    console.warn(JSON.stringify({ event: 'api_rate_limit', outcome }));
  };
}

export function createRateLimitGuard(options: {
  settings: Settings;
  check?: RateLimitCheck;
  /** Server-side verifier only. Never read user IDs from request fields or client headers. */
  resolveVerifiedUser?: (req: any) => Promise<string | null>;
  observe?: Observer;
}) {
  const { settings, resolveVerifiedUser } = options;
  const check = options.check ?? vercelRateLimitCheck;
  const observe = options.observe ?? createObserver();
  const admitted = new AsyncLocalStorage<object>();

  async function admit(req: any) {
    // Local development has no shared Firewall. Do not pretend a process-local Map
    // protects a deployed app, or trust platform headers outside the platform.
    if (!settings.platform || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(settings.host) || process.env.NODE_ENV === 'development')
      throw new RateLimitRejection(503);
    const ip = platformClientIp(req);
    async function consume(id: string, key: string) {
      // One attempt only: a retry after a lost reply might count the request twice.
      const result = await withRequestDeadline(settings.timeoutMs, () => check({ id, key, ip, host: settings.host, timeoutMs: settings.timeoutMs }));
      if (!result || typeof result.rateLimited !== 'boolean' || result.error) throw new RateLimitRejection(503);
      if (result.rateLimited) throw new RateLimitRejection(429);
    }
    await consume(API_RATE_LIMITS.id, bucket(settings.namespace, 'ip', ip));
    if (resolveVerifiedUser) {
      const user = await withRequestDeadline(settings.timeoutMs, () => resolveVerifiedUser(req));
      if (user !== null) {
        if (typeof user !== 'string' || !user || user.length > 512) throw new RateLimitRejection(503);
        // This is independent of IP: changing networks cannot reset an account quota.
        await consume(API_RATE_LIMITS.id, bucket(settings.namespace, 'user', user));
      }
    }
  }

  return {
    async run<T>(req: object, operation: () => Promise<T>): Promise<T> {
      if (settings.mode === 'off' || admitted.getStore() === req) return operation();
      try { await admit(req); }
      catch (error) {
        const rejection = error instanceof RateLimitRejection ? error : new RateLimitRejection(503);
        observe(rejection.status === 429 ? 'limited' : 'unavailable');
        if (settings.mode === 'enforce') throw rejection;
      }
      // The scope ends with this handler. Nested /api/live dispatch is counted once;
      // parallel external invocations never share a request's admission state.
      return admitted.run(req, operation);
    },
  };
}

// Login is on hold: no client-provided pseudo identity, new cookie, or fake account limit.
export const publicRateLimitGuard = createRateLimitGuard({ settings: config.server.rateLimit });
