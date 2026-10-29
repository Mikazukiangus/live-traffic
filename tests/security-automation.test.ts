import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
test('all workflows pin actions, restrict token permissions and avoid persistent checkout credentials', () => {
  for (const file of ['.github/workflows/checks.yml', '.github/workflows/health.yml']) {
    const source = read(file);
    for (const match of source.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(match[1], /^[\w/-]+@[a-f0-9]{40}$/, file);
    assert.match(source, /permissions:\s*\n\s+contents: read/);
    assert.match(source, /persist-credentials: false/);
  }
});

test('required CI scans full history, dependencies and built assets; the local hook fails closed', () => {
  const source = read('.github/workflows/checks.yml');
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /gitleaks git.*--redact=100.*--log-opts="--all"/);
  assert.match(source, /bun audit --audit-level=high/);
  assert.match(source, /gitleaks dir.*--redact=100.*dist/);
  assert.match(read('.githooks/pre-commit'), /exec node --import tsx scripts\/secret-scan.ts/);
  assert.match(read('.github/dependabot.yml'), /package-ecosystem: npm/);
  assert.match(read('.github/dependabot.yml'), /package-ecosystem: github-actions/);
  const installer = read('scripts/install-gitleaks.sh');
  assert.match(installer, /version=8\.30\.1/);
  assert.match(installer, /shasum -a 256 -c/);
  assert.match(installer, /--proto '=https'.*--proto-redir '=https'/);
});
