import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('scanner installer verifies checksum and exact version before installing; all downloads are local fixtures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trafficpulse-scanner-install-'));
  try {
    const bin = join(directory, 'fake-bin'), source = join(directory, 'source'), destination = join(directory, 'destination');
    mkdirSync(bin); mkdirSync(source);
    const archive = join(directory, 'fixture.tar.gz'), manifest = join(directory, 'fixture-checksums.txt');
    const marker = join(directory, 'binary-executed');
    writeFileSync(join(bin, 'uname'), '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo x86_64; fi\n', { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\nfor last do :; done\ncase "$*" in *checksums.txt*) cp "$FIXTURE_MANIFEST" "$last";; *) cp "$FIXTURE_ARCHIVE" "$last";; esac\n', { mode: 0o755 });
    writeFileSync(join(source, 'gitleaks'), '#!/bin/sh\necho executed >> "$BINARY_EXECUTION_MARKER"\necho "${FIXTURE_VERSION:-8.30.1}"\n', { mode: 0o755 });
    execFileSync('tar', ['-czf', archive, '-C', source, 'gitleaks']);
    const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, FIXTURE_ARCHIVE: archive, FIXTURE_MANIFEST: manifest,
      BINARY_EXECUTION_MARKER: marker, FIXTURE_VERSION: '8.30.1' };
    const run = (extra = {}) => spawnSync('sh', [fileURLToPath(new URL('../scripts/install-gitleaks.sh', import.meta.url)), destination],
      { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 });
    writeFileSync(manifest, `${'0'.repeat(64)}  gitleaks_8.30.1_linux_x64.tar.gz\n`);
    assert.notEqual(run().status, 0); assert.equal(existsSync(marker), false); assert.equal(existsSync(destination), false);
    writeFileSync(manifest, `${checksum}  gitleaks_8.30.1_linux_x64.tar.gz\n`);
    assert.notEqual(run({ FIXTURE_VERSION: '0.0.0' }).status, 0); assert.equal(existsSync(destination), false);
    assert.equal(run().status, 0); assert.equal(existsSync(join(destination, 'gitleaks')), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
