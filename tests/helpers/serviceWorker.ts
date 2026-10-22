import { readFile } from 'node:fs/promises';
import { createPublicConfig } from '../../config/schema.ts';
import { renderServiceWorker } from '../../server/serviceWorker.ts';

export async function serviceWorkerSource(timeouts = createPublicConfig().timeouts) {
  return renderServiceWorker(await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'), timeouts);
}
export function workerGlobals() {
  return { URL, Request, Headers, Response, Date, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout };
}
