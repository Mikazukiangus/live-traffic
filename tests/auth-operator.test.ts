import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseAuthOperatorArgs, authOperatorConnections } from '../scripts/auth-operator-input.ts';

const fixture = {
  DATABASE_URL: 'postgresql://operator:synthetic-private-marker@ep-fixture-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  DATABASE_URL_UNPOOLED: 'postgresql://operator:synthetic-private-marker@ep-fixture.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
};
test('operator tasks accept hidden prompts or process credentials and one exact Preview destination', () => {
  for (const task of ['migrate', 'smoke', 'create-user']) assert.equal(parseAuthOperatorArgs([task, '--prompt']).task, task);
  const result = parseAuthOperatorArgs(['preview-smoke', '--prompt', 'https://live-traffic-fixture-carbon-bc04.vercel.app']);
  assert.equal(result.prompt, true); assert.equal(result.deployment, 'https://live-traffic-fixture-carbon-bc04.vercel.app');
});
test('operator arguments reject legacy variable IDs, credentials in argv and production/unrelated URLs', () => {
  for (const args of [['smoke', 'old-database-id', 'old-direct-id'], ['smoke', fixture.DATABASE_URL],
    ['smoke', '--prompt', '--prompt'], ['preview-smoke', 'https://live-traffic-carbon-bc04.vercel.app'],
    ['preview-smoke', 'https://live-traffic-fixture-carbon-bc04.vercel.app/path'], ['preview-smoke', 'https://evil.example'], ['unknown']])
    assert.throws(() => parseAuthOperatorArgs(args), (error: Error) => !error.message.includes('synthetic-private-marker'));
});
test('operator pooled and direct connections must identify the same TLS account/database', () => {
  assert.deepEqual(authOperatorConnections(fixture), { pooled: fixture.DATABASE_URL, direct: fixture.DATABASE_URL_UNPOOLED });
  for (const change of ['/otherdb?sslmode=require', '/neondb?sslmode=disable']) {
    assert.throws(() => authOperatorConnections({ ...fixture, DATABASE_URL_UNPOOLED: fixture.DATABASE_URL_UNPOOLED.replace('/neondb?sslmode=require', change) }));
  }
  for (const edit of [fixture.DATABASE_URL, fixture.DATABASE_URL_UNPOOLED.replace('operator:', 'other:'),
    fixture.DATABASE_URL_UNPOOLED.replace('synthetic-private-marker', 'another-private-marker'), fixture.DATABASE_URL_UNPOOLED.replace('ep-fixture.', 'ep-other.')])
    assert.throws(() => authOperatorConnections({ ...fixture, DATABASE_URL_UNPOOLED: edit }));
});
test('operator inputs fail closed for absent, unsafe or production credentials without reflecting values', () => {
  for (const env of [{}, { ...fixture, VERCEL_ENV: 'production' }, { ...fixture, DATABASE_URL: 'https://private-marker.example/' },
    { ...fixture, DATABASE_URL: fixture.DATABASE_URL.replace('aws.neon.tech', 'evil.example') },
    { ...fixture, DATABASE_URL: fixture.DATABASE_URL + '\n' }]) assert.throws(() => authOperatorConnections(env), (error: Error) =>
    !error.message.includes('private-marker') && !error.message.includes('postgresql://'));
});
test('operator bootstrap no longer exports environments, requests Secret readback or accepts old ID commands', () => {
  const source = readFileSync(new URL('../scripts/auth-with-database.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('spawnSync')); assert.ok(!source.includes('/env/')); assert.ok(!source.includes('env pull'));
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/auth-with-database.ts', 'smoke', 'old-database-id', 'old-direct-id'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH },
  });
  assert.equal(child.status, 1); assert.match(child.stderr, /AUTH_BOOTSTRAP_FAILED/);
  assert.ok(!child.stderr.includes('old-database-id'));
});
