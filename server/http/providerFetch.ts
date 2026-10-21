import { providerDispatcher, validateOutboundUrl } from './ssrf.ts';

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
  const options = { ...init, redirect: 'error' as const, dispatcher: providerDispatcher };
  return transport(target, options);
}
