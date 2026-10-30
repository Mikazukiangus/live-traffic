import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GITLEAKS_VERSION, scanStagedSecrets, type SecretScanRunner } from '../scripts/secret-scan.ts';

test('real pinned scanner detects proprietary credential canaries in quoted and unquoted forms with full redaction', () => {
  assert.equal(spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).stdout?.trim(), GITLEAKS_VERSION,
    'Install the pinned scanner before running integration tests; see SECURITY.md');
  const canary = randomBytes(32).toString('base64'); // Generated fixture, never a provider-issued credential.
  for (const [input, rule] of [[`LTA_ACCOUNT_KEY="${canary}"`, 'trafficpulse-private-setting-literal'],
    [`LTA_ACCOUNT_KEY=${canary}`, 'trafficpulse-unquoted-env-credential']]) {
    const result = spawnSync('gitleaks', ['stdin', '--redact=100', '--no-banner', '--log-level=error',
      '--config', fileURLToPath(new URL('../.gitleaks.toml', import.meta.url)), '--report-format=json', '--report-path=-'],
    { input, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, 'A credential-shaped canary must be rejected');
    assert.ok(!result.stdout.includes(canary) && !result.stderr.includes(canary), 'Scanner output must redact canaries');
    const report = JSON.parse(result.stdout) as { RuleID: string }[];
    assert.ok(report.some(item => item.RuleID === rule), 'The proprietary-key rule must actually execute');
  }
});

test('real pre-commit scanner rejects newly added test secrets despite historical exceptions', () => {
  const canary = randomBytes(32).toString('base64');
  const run: SecretScanRunner = (command, args, options) => command === 'git'
    ? { status: 0, stdout: `+++ b/tests/config.test.ts\n+const LTA_ACCOUNT_KEY = "${canary}";` }
    : spawnSync(command, args, options);
  const result = scanStagedSecrets(run);
  assert.deepEqual(result, { ok: false, code: 'REJECTED' });
  assert.ok(!JSON.stringify(result).includes(canary));
});
