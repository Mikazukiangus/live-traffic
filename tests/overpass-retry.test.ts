import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('optional Python map-query helper retries only known read-only transient failures', (t) => {
  const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_overpass_http.py'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    t.skip('Python3 is not installed; web app tests do not require Python');
    return;
  }
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 4 tests/);
});
