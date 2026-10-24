import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Finding {
  file: string;
  line: number;
  code: 'INSECURE_URL' | 'COOKIE_POLICY_REVIEW';
}
const insecure =
  /\b(?:http|ws):\/\/|(?:["'`]\/\/[a-z0-9])|(?:\b(?:src|href|poster)\s*=\s*["']|url\(\s*["']?)\/\//i;
const cookiePath =
  /["'`]set-cookie["'`]|\.\s*(?:cookies?|setCookie)\b|\[\s*["'](?:cookies?|setCookie)["']\s*\]|\b(?:cookies|setCookie)\s*\(|\bcookieStore\b|["'](?:cookie|cookie-parser|js-cookie|cookies-next|nookies)["']/i;

// Exact reviewed reads/writes only. The auth response writer validates prefix,
// host-only scope, HttpOnly, SameSite=Lax, Path=/ and production Secure at runtime.
// Any changed/new cookie operation continues to require review; no general bypass.
const reviewedCookieLines: Record<string, ReadonlySet<string>> = {
  'server/auth/service.ts': new Set([
    "const value = headers.get('cookie') ?? '';",
    "for (const key of ['cookie', 'origin', 'content-type', 'sec-fetch-site', 'x-real-ip']) {",
  ]),
  'server/auth/respond.ts': new Set([
    "for (const cookie of validatedAuthCookies(cookies)) headers.append('Set-Cookie', cookie);",
    "response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });",
    "if (values.length) res.setHeader('Set-Cookie', values);",
  ]),
};

/** Conservative source gate, not a general taint analyzer. Findings never include URL/cookie values. */
export function auditTransportSource(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const flag = (position: number, code: Finding['code']) => {
    const line = text.slice(0, position).split('\n').length;
    const key = `${line}:${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ file, line, code });
    }
  };
  let offset = 0;
  for (const line of text.split('\n')) {
    // SVG namespace identifiers describe a vocabulary; they never fetch network content.
    const content = line
      .replace(/\bxmlns(?::\w+)?\s*=\s*(["'])http:\/\/www\.w3\.org\/[^"']+\1/g, '')
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (insecure.test(content)) flag(offset, 'INSECURE_URL');
    if (cookiePath.test(content) && !reviewedCookieLines[file]?.has(content.trim())) flag(offset, 'COOKIE_POLICY_REVIEW');
    offset += line.length + 1;
  }
  return findings;
}

export async function auditProjectTransport(root: string) {
  const findings: Finding[] = [];
  const walk = async (relative: string) => {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (/\.(?:[cm]?[jt]sx?|css|html|svg|json|webmanifest)$/.test(name))
        findings.push(...auditTransportSource(name, await readFile(path.join(root, name), 'utf8')));
    }
  };
  for (const directory of ['src', 'api', 'server', 'shared', 'config', 'public']) await walk(directory);
  for (const file of ['index.html', 'vercel.json', 'package.json'])
    findings.push(...auditTransportSource(file, await readFile(path.join(root, file), 'utf8')));
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = await auditProjectTransport(path.resolve(import.meta.dirname, '..'));
  // Print locations/classifications only, never rejected text, signed URLs or cookie values.
  findings.forEach((finding) => console.error(JSON.stringify(finding)));
  if (findings.length) process.exitCode = 1;
  else
    console.log(
      'Transport audit passed: no insecure resource URL literals or unreviewed cookie operations found.',
    );
}
