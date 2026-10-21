import { config } from '../../config/server.ts';

/** Validate before sending credentials. Never follow redirects, including HTTPS-to-HTTP downgrades. */
export function fetchProvider(
  input: string | URL,
  init: RequestInit = {},
  transport: typeof fetch = globalThis.fetch,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Provider URL must use HTTPS');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const localTest = config.server.allowLoopbackHttp && loopback && url.protocol === 'http:';
  if ((url.protocol !== 'https:' && !localTest) || url.username || url.password)
    throw new Error('Provider URL must use HTTPS without embedded credentials');
  // Preserve signed query bytes; the original URL and headers never enter our errors.
  return transport(input, { ...init, redirect: 'error' });
}
