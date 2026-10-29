import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GITLEAKS_VERSION, scanStagedSecrets, type SecretScanRunner } from '../scripts/secret-scan.ts';

test('staged scan sends bytes only to the pinned scanner with full redaction and never returns its diagnostic contents', () => {
  const staged = '+++ b/.env.fixture\n-REMOVED="synthetic-old-marker"\n+LTA_ACCOUNT_KEY="synthetic-private-marker"';
  const calls: { command: string; args: readonly string[]; options: any }[] = [];
  const run = ((command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git') return { status: 0, stdout: staged };
    if (args[0] === 'version') return { status: 0, stdout: GITLEAKS_VERSION + '\n' };
    return { status: 1, stdout: staged, stderr: staged };
  }) as SecretScanRunner;
  const result = scanStagedSecrets(run);
  assert.deepEqual(result, { ok: false, code: 'REJECTED' });
  assert.ok(!JSON.stringify(result).includes('synthetic-private-marker'));
  assert.deepEqual(calls[0].args, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--unified=0', '--']);
  assert.equal(calls[2].command, 'gitleaks'); assert.ok(calls[2].args.includes('--redact=100'));
  assert.ok(calls[2].args.includes('--config')); assert.equal(calls[2].options.input, 'LTA_ACCOUNT_KEY="synthetic-private-marker"');
  assert.equal(calls[2].options.timeout, 60000);
});

test('missing/wrong-version tools, unreadable diffs, process errors and scanner failures block commits', () => {
  for (const fault of ['diff', 'missing', 'version', 'crash']) {
    let scans = 0;
    const run = ((command, args) => {
      if (command === 'git') return { status: fault === 'diff' ? 1 : 0, stdout: '+synthetic fixture' };
      if (args[0] === 'version') return fault === 'missing' ? { error: new Error('synthetic-only'), status: null } :
        { status: 0, stdout: fault === 'version' ? '0.0.0' : GITLEAKS_VERSION };
      scans++; return { status: null, error: new Error('synthetic-only') };
    }) as SecretScanRunner;
    assert.equal(scanStagedSecrets(run).ok, false, fault);
    assert.equal(scans, fault === 'crash' ? 1 : 0);
  }
});

test('clean scans and empty staged diffs succeed without allowing failures to pass silently', () => {
  for (const empty of [false, true]) {
    let scans = 0;
    const run = ((command, args) => {
      if (command === 'git') return { status: 0, stdout: empty ? '' : '+synthetic fixture' };
      if (args[0] === 'version') return { status: 0, stdout: GITLEAKS_VERSION };
      scans++; return { status: 0 };
    }) as SecretScanRunner;
    assert.equal(scanStagedSecrets(run).ok, true); assert.equal(scans, empty ? 0 : 1);
  }
});

test('removing a secret is allowed without resubmitting deleted bytes to the scanner', () => {
  const run = (() => ({ status: 0, stdout: '--- a/.env.fixture\n+++ b/.env.fixture\n-REMOVED="synthetic-old-marker"' })) as SecretScanRunner;
  assert.deepEqual(scanStagedSecrets(run), { ok: true, code: 'NO_CHANGES' });
});
