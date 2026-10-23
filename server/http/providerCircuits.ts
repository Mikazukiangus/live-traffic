import { config } from '../../config/server.ts';
import { IMAGE_PROXY_HOSTS } from '../../config/policy.ts';
import { createCircuitRunner } from './circuitBreaker.ts';

const endpoints = Object.entries(config.server.upstreams)
  .filter(([key]) => key !== 'ltaBase')
  .map(([key, value]) => ({ key, url: new URL(value) }));
endpoints.push({ key: 'publicCameraMetadata', url: new URL(config.trafficImagesUrl) });

/** Ignore pagination/date/signature parameters, but distinguish the two NEA /weather feeds. */
export function providerCircuitScope(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  for (const endpoint of endpoints) {
    if (url.origin === endpoint.url.origin && url.pathname === endpoint.url.pathname &&
      url.searchParams.get('api') === endpoint.url.searchParams.get('api')) return endpoint.key;
  }
  if (url.protocol === 'https:' && !url.port && IMAGE_PROXY_HOSTS.includes(url.hostname)) return `image:${url.hostname}`;
  return null; // New dependencies must be registered; never create unbounded URL-based state.
}

/** Shared by application readers and health probes within this warm function instance only. */
export const withProviderCircuit = createCircuitRunner(config.server.circuit, providerCircuitScope);
