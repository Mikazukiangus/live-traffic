import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

function assertPatched(version: string) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(parts, 'Review prerelease/unrecognized Zod versions explicitly');
  const [, major, minor, patch] = parts.map(Number);
  assert.ok(major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))),
    'A vulnerable Zod release is present');
}

test('every locked Zod copy includes the fix for GHSA-mrhx-c7xc-m3w5', () => {
  const lock = readFileSync(new URL('../bun.lock', import.meta.url), 'utf8');
  const versions = [...lock.matchAll(/:\s*\["zod@([^"]+)"/g)].map(match => match[1]);
  assert.ok(versions.length > 0);
  for (const version of versions) {
    assertPatched(version);
  }
});

test('the installed Vercel SDK resolves patched Zod, including incremental install layouts', () => {
  const fromSdk = createRequire(import.meta.resolve('@vercel/cli-config'));
  assertPatched(JSON.parse(readFileSync(fromSdk.resolve('zod/package.json'), 'utf8')).version);
});
