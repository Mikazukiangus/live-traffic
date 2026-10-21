import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sentinel = 'trafficpulse-build-private-sentinel-725193';

test('real production build applies public overrides while excluding private key values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trafficpulse-config-build-'));
  try {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', directory], {
      cwd: root, env: { ...process.env, LTA_ACCOUNT_KEY: sentinel, VITE_SITE_URL: 'https://config-test.example', VITE_CAMERA_POLL_MS: '45678',
        VITE_VERCEL_PROJECT_ID: 'platform-project', VITE_VERCEL_DEPLOYMENT_ID: 'platform-deployment', VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG: '{}' },
      stdio: 'pipe', timeout: 30000,
    });
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.match(html, /https:\/\/config-test\.example\/og-image\.png/);
    assert.ok(!html.includes('__TRAFFICPULSE_SITE_URL__'));
    const assets = await readdir(path.join(directory, 'assets'));
    const scripts = await Promise.all(assets.filter((name) => name.endsWith('.js')).map((name) => readFile(path.join(directory, 'assets', name), 'utf8')));
    const bundle = scripts.join('\n');
    assert.ok(!bundle.includes(sentinel), 'Private LTA key entered a public asset');
    assert.ok(bundle.includes('45678'), 'Public camera interval override was not included');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real browser build rejects an accidental server-config import', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trafficpulse-config-boundary-'));
  try {
    const entry = path.join(directory, 'entry.ts');
    await writeFile(entry, `import { config } from ${JSON.stringify(path.join(root, 'config/server.ts'))}; console.log(config);`);
    const program = `
      import { build } from 'vite';
      try {
        await build({ configFile: ${JSON.stringify(path.join(root, 'vite.config.ts'))}, logLevel: 'silent',
          build: { lib: { entry: ${JSON.stringify(entry)}, formats: ['es'] }, outDir: ${JSON.stringify(path.join(directory, 'out'))} } });
      } catch (error) {
        if (String(error).includes('Server config cannot be included in the browser bundle')) process.exit(0);
        throw error;
      }
      throw new Error('Browser build accepted server configuration');
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: root, env: { ...process.env, LTA_ACCOUNT_KEY: sentinel }, stdio: 'pipe', timeout: 30000,
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid environment fails at build startup without logging supplied values', () => {
  assert.throws(() => execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: root, env: { ...process.env, LTA_ACCOUNT_KEY: sentinel, DEV_PORT: 'bad-port-private-marker' },
    stdio: 'pipe', timeout: 30000,
  }), (error: unknown) => {
    const stderr = String((error as { stderr?: Buffer }).stderr || '');
    assert.match(stderr, /Invalid configuration/);
    assert.match(stderr, /DEV_PORT/);
    assert.ok(!stderr.includes(sentinel));
    assert.ok(!stderr.includes('bad-port-private-marker'));
    return true;
  });
});

test('production build rejects HTTP resource configuration even when NODE_ENV is incorrectly development', () => {
  assert.throws(() => execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'development', LTA_ACCOUNT_KEY: sentinel, VITE_TRAFFIC_IMAGES_URL: 'http://localhost:4500/private-marker' },
    stdio: 'pipe', timeout: 30000,
  }), (error: unknown) => {
    const stderr = String((error as { stderr?: Buffer }).stderr || '');
    assert.match(stderr, /VITE_TRAFFIC_IMAGES_URL/);
    assert.ok(!stderr.includes('private-marker'));
    assert.ok(!stderr.includes(sentinel));
    return true;
  });
});
