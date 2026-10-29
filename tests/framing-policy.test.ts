import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('HTML, APIs and assets deny framing without changing script, worker or transport protections', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rules = config.headers.filter((rule: { source: string }) => rule.source === '/(.*)');
  assert.equal(rules.length, 1);
  const headers = Object.fromEntries(rules[0].headers.map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]));
  const policy = new Map<string, string[]>(headers['content-security-policy'].split(';').filter(Boolean).map((raw: string) => {
    const [name, ...values] = raw.trim().split(/\s+/); return [name, values];
  }));
  assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.deepEqual(policy.get('script-src'), ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(policy.get('worker-src'), ["'self'", 'blob:']);
  assert.ok(policy.has('upgrade-insecure-requests'));
});
