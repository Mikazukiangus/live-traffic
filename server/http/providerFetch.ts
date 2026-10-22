import { providerDispatcher, validateOutboundUrl } from './ssrf.ts';
import { config } from '../../config/server.ts';

/** Validate before sending credentials. Never follow redirects, including HTTPS-to-HTTP downgrades. */
export function fetchProvider(
  input: string | URL,
  init: RequestInit = {},
  transport: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const target = String(input);
  validateOutboundUrl(target);
  // Preserve signed query bytes; the original URL and headers never enter our errors.
  // Caller-provided dispatchers cannot replace the guarded socket lookup.
  const options = {
    ...init,
    // Existing call sites supply their own feed-specific deadline. Protect omitted signals too.
    signal: init.signal ?? AbortSignal.timeout(config.server.requestTimeoutMs),
    redirect: 'error' as const,
    dispatcher: providerDispatcher,
  };
  return transport(target, options);
}
