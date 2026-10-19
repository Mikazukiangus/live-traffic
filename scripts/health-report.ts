import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Use our labels/paths, never strings returned by a server or its upstream providers.
export const HEALTH_FEEDS = [
  ['/api/health', 'Gateway health'],
  ['/api/traffic', 'Traffic incidents'],
  ['/api/trafficimages', 'Traffic cameras'],
  ['/api/trafficflow', 'Speed bands'],
  ['/api/expresswayspeeds', 'Speed summary'],
  ['/api/vms', 'Message signs'],
  ['/api/traveltimes', 'Travel times'],
  ['/api/rainforecast', 'Two-hour forecast'],
  ['/api/forecast24h', '24-hour forecast'],
  ['/api/airquality', 'Air quality'],
  ['/api/live?feed=roadconditions', 'Road conditions'],
  ['/api/live?feed=carparks', 'Car parks'],
  ['/api/live?feed=weatheralerts', 'Lightning and heat'],
  ['/api/live?feed=floods', 'Flood alerts'],
  ['/api/imageproxy', 'Camera image proxy'],
] as const;

interface Result {
  allUp: boolean;
  failed: boolean;
  summary: string;
  annotations: { level: 'error' | 'warning'; message: string }[];
}
const invalid = (): Result => ({ allUp: false, failed: true, summary: '### TrafficPulse health: invalid response\n',
  annotations: [{ level: 'error', message: 'Invalid health response; provider text omitted.' }] });

/** Numeric measurements and a fixed catalogue are the only data allowed into CI output. */
export function healthReport(payload: unknown, httpCode: number): Result {
  if (!Number.isInteger(httpCode) || httpCode < 0 || httpCode > 599) return invalid();
  if (httpCode !== 200) return { allUp: false, failed: true, summary: '### TrafficPulse health: request failed\n',
    annotations: [{ level: 'error', message: `Health endpoint answered HTTP ${httpCode}.` }] };
  const data = payload as any;
  if (!data || !Array.isArray(data.endpoints) || data.endpoints.length !== HEALTH_FEEDS.length ||
      data.totalCount !== HEALTH_FEEDS.length) return invalid();
  const rows: { path: string; name: string; status: 'UP' | 'DOWN'; httpCode: number; latencyMs: number }[] = [];
  for (const [path, name] of HEALTH_FEEDS) {
    const matches = data.endpoints.filter((e: any) => e && e.path === path);
    if (matches.length !== 1) return invalid();
    const e = matches[0];
    if (!['UP', 'DOWN'].includes(e.status) || !Number.isInteger(e.httpCode) || e.httpCode < 0 || e.httpCode > 599 ||
        !Number.isFinite(e.latencyMs) || e.latencyMs < 0 || e.latencyMs > 86400000 ||
        (e.status === 'UP') !== (e.httpCode >= 200 && e.httpCode < 300)) return invalid();
    rows.push({ path, name, status: e.status, httpCode: e.httpCode, latencyMs: Math.round(e.latencyMs) });
  }
  const up = rows.filter((row) => row.status === 'UP').length;
  if (data.upCount !== up || data.operational !== (up === rows.length)) return invalid();
  const down = rows.filter((row) => row.status !== 'UP');
  return {
    allUp: down.length === 0,
    failed: down.some((row) => row.httpCode !== 429),
    summary: `### TrafficPulse health: ${up} of ${rows.length} feeds up\n\n` +
      '| Status | Feed | Path | HTTP | Latency |\n|---|---|---|---|---|\n' +
      rows.map((row) => `| ${row.status} | ${row.name} | ${row.path} | ${row.httpCode} | ${row.latencyMs} ms |`).join('\n') + '\n',
    annotations: down.map((row) => ({ level: row.httpCode === 429 ? 'warning' : 'error',
      message: `${row.name} (${row.path}): ${row.httpCode === 429 ? 'rate limited upstream' : 'unavailable'} (HTTP ${row.httpCode}).` })),
  };
}

function main() {
  const [mode, path, status] = process.argv.slice(2);
  let result: Result;
  try {
    const body = readFileSync(path, 'utf8');
    result = healthReport(JSON.parse(body), /^\d{3}$/.test(status || '') ? Number(status) : -1);
  } catch { result = invalid(); }
  if (mode === '--check') { process.exitCode = result.allUp ? 0 : 1; return; }
  if (mode !== '--report') result = invalid();
  try {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.summary);
    for (const item of result.annotations) console.log(`::${item.level}::${item.message}`);
    console.log(result.allUp ? 'All health feeds are up.' : result.failed ? 'Health check failed.' : 'Health check completed with upstream rate limits.');
    process.exitCode = result.failed ? 1 : 0;
  } catch {
    console.error('::error::Unable to write the health report.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
