import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GITLEAKS_VERSION = '8.30.1';
type Result = { ok: boolean; code: 'CLEAN' | 'NO_CHANGES' | 'DIFF_FAILED' | 'SCANNER_UNAVAILABLE' | 'REJECTED' };
export type SecretScanRunner = (command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding) =>
  { status: number | null; stdout?: string; error?: Error };

/** Scan staged bytes in memory, not an unredacted report or temporary file. Fail closed on tool errors. */
export function scanStagedSecrets(run: SecretScanRunner = (command, args, options) => spawnSync(command, args, options)): Result {
  const diff = run('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--unified=0', '--'],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (diff.error || diff.status !== 0 || typeof diff.stdout !== 'string') return { ok: false, code: 'DIFF_FAILED' };
  // Only additions: deleting an exposed secret must not itself be blocked by the hook.
  const added = diff.stdout.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++ '))
    .map(line => line.slice(1)).join('\n');
  if (!added) return { ok: true, code: 'NO_CHANGES' };
  const version = run('gitleaks', ['version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (version.error || version.status !== 0 || version.stdout?.trim() !== GITLEAKS_VERSION) return { ok: false, code: 'SCANNER_UNAVAILABLE' };
  const scan = run('gitleaks', ['stdin', '--redact=100', '--no-banner', '--config', fileURLToPath(new URL('../.gitleaks.toml', import.meta.url))],
    { input: added, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  // Even scanner diagnostics can contain filenames or submitted material: emit fixed text only.
  return scan.error || scan.status !== 0 ? { ok: false, code: 'REJECTED' } : { ok: true, code: 'CLEAN' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanStagedSecrets();
  const messages = { CLEAN: 'Staged secret scan passed.', NO_CHANGES: 'No staged changes.', DIFF_FAILED: 'Cannot read staged changes; commit blocked.',
    SCANNER_UNAVAILABLE: 'Pinned Gitleaks 8.30.1 is required on PATH; commit blocked. See SECURITY.md.',
    REJECTED: 'Secret scan rejected staged changes or failed; commit blocked. Review locally with full redaction.' };
  console[result.ok ? 'log' : 'error'](messages[result.code]);
  process.exitCode = result.ok ? 0 : 1;
}
