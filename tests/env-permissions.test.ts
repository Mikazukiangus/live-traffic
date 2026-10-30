import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('project private environment files are owner-only without reading any credential contents', { skip: process.platform === 'win32' }, () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const name of readdirSync(root).filter(name => name.startsWith('.env') && name !== '.env.example')) {
    const metadata = lstatSync(join(root, name));
    assert.equal(metadata.isSymbolicLink(), false, 'Private env symlinks need explicit review');
    if (metadata.isFile()) assert.equal(metadata.mode & 0o077, 0, 'Private env files must not grant group/other access');
  }
});

test('permission checker rejects broad modes and symlinks, permits owner-only files and skips the public example', { skip: process.platform === 'win32' }, async () => {
  const { checkPrivateEnvPermissions } = await import('../scripts/check-env-permissions.ts');
  const root = mkdtempSync(join(tmpdir(), 'trafficpulse-env-modes-'));
  try {
    writeFileSync(join(root, '.env.local'), 'synthetic-only', { mode: 0o600 });
    writeFileSync(join(root, '.env.example'), 'PUBLIC_PLACEHOLDER=', { mode: 0o644 });
    assert.deepEqual(checkPrivateEnvPermissions(root), { ok: true, invalidCount: 0 });
    chmodSync(join(root, '.env.local'), 0o644);
    assert.deepEqual(checkPrivateEnvPermissions(root), { ok: false, invalidCount: 1 });
    chmodSync(join(root, '.env.local'), 0o600);
    symlinkSync(join(root, '.env.local'), join(root, '.env.preview'));
    assert.deepEqual(checkPrivateEnvPermissions(root), { ok: false, invalidCount: 1 });
    assert.equal(checkPrivateEnvPermissions(join(root, 'missing')).ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
