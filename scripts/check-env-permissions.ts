import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Inspect metadata only. Never read, stringify or report credential values or filenames. */
export function checkPrivateEnvPermissions(directory: string): { ok: boolean; invalidCount: number } {
  if (process.platform === 'win32') return { ok: true, invalidCount: 0 }; // Windows ACLs need a separate review.
  let invalidCount = 0;
  try {
    for (const name of readdirSync(directory)) {
      if (!name.startsWith('.env') || name === '.env.example') continue;
      const metadata = lstatSync(join(directory, name));
      if (metadata.isSymbolicLink() || (metadata.isFile() && (metadata.mode & 0o077) !== 0)) invalidCount++;
    }
    return { ok: invalidCount === 0, invalidCount };
  } catch { return { ok: false, invalidCount: Math.max(1, invalidCount) }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkPrivateEnvPermissions(fileURLToPath(new URL('../', import.meta.url)));
  console[result.ok ? 'log' : 'error'](result.ok ? 'Private env permission check passed.' :
    'Private env permissions need review: use owner-only files, not symlinks. See SECURITY.md.');
  process.exitCode = result.ok ? 0 : 1;
}
