import { readdir, readFile } from 'node:fs/promises';
import { transformSync } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERAGE_ROOTS = ['api', 'config', 'server', 'shared', 'src'] as const;
type Metric = { covered: number; total: number; percent: number | null };
type Measurements = { lines: Metric; branches: Metric; functions: Metric };
export const metric = (covered: number, total: number): Metric => ({ covered, total, percent: total ? Math.round(covered / total * 10000) / 100 : null });

function sourcePath(value: string, root: string) {
  const absolute = value.startsWith('file:') ? fileURLToPath(value) : path.resolve(root, value);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  return COVERAGE_ROOTS.some(directory => relative.startsWith(directory + '/')) && !relative.split('/').includes('..') ? relative : null;
}

/** LCOV reports loaded code only. Never silently count a missing source as covered. */
export function parseLcov(text: string, root: string): Map<string, Measurements> {
  const counters = new Map<string, { lines: Map<string, boolean>; branches: Map<string, boolean>; functions: Map<string, boolean> }>();
  let current: ReturnType<typeof counters.get>;
  const hit = (target: Map<string, boolean>, key: string, count: string) => {
    if (count !== '-' && !/^\d+$/.test(count)) throw new Error('Invalid coverage count');
    target.set(key, Boolean(target.get(key)) || (count !== '-' && Number(count) > 0));
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      const file = sourcePath(line.slice(3), root);
      if (!file) { current = undefined; continue; }
      if (!counters.has(file)) counters.set(file, { lines: new Map(), branches: new Map(), functions: new Map() });
      current = counters.get(file);
    } else if (line === 'end_of_record') current = undefined;
    else if (current && line.startsWith('DA:')) { const [number, count] = line.slice(3).split(','); hit(current.lines, number, count); }
    else if (current && line.startsWith('BRDA:')) { const [number, block, branch, count] = line.slice(5).split(','); hit(current.branches, `${number}:${block}:${branch}`, count); }
    else if (current && line.startsWith('FNDA:')) { const comma = line.indexOf(','); hit(current.functions, line.slice(comma + 1), line.slice(5, comma)); }
  }
  return new Map([...counters].map(([file, groups]) => [file, Object.fromEntries(Object.entries(groups).map(([kind, values]) =>
    [kind, metric([...values.values()].filter(Boolean).length, values.size)])) as Measurements]));
}

export async function sourceInventory(root: string) {
  const runtime: string[] = [], typeOnly: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const file = directory + '/' + entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.tsx?$/.test(file) && !file.endsWith('.d.ts')) {
        const source = await readFile(path.join(root, file), 'utf8');
        // Type erasure parses source without executing it or importing application configuration.
        const emitted = transformSync(source, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm', jsx: 'automatic', legalComments: 'none', target: 'es2022' }).code;
        const code = emitted.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\bexport\s*\{\s*\};?/g, '').replace(/^\s*;\s*$/gm, '').trim();
        (code ? runtime : typeOnly).push(file);
      }
    }
  };
  for (const directory of COVERAGE_ROOTS) await walk(directory);
  return { runtime: runtime.sort(), typeOnly: typeOnly.sort() };
}

export async function buildCoverageReport(text: string, root: string, testExitCode: number) {
  const measured = parseLcov(text, root), inventory = await sourceInventory(root);
  const files = inventory.runtime.map(file => ({ file, loaded: measured.has(file), measured: measured.get(file) ?? null }));
  const totals = Object.fromEntries(['lines', 'branches', 'functions'].map(kind => {
    const values = files.flatMap(file => file.measured ? [file.measured[kind as keyof Measurements]] : []);
    return [kind, metric(values.reduce((sum, value) => sum + value.covered, 0), values.reduce((sum, value) => sum + value.total, 0))];
  })) as Measurements;
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), nodeVersion: process.version, testExitCode,
    scope: [...COVERAGE_ROOTS], runtimeFiles: files.length, loadedFiles: files.filter(file => file.loaded).length,
    typeOnlyFiles: inventory.typeOnly, loadedModuleCoverage: totals, files,
    limitations: [
      'Loaded-module coverage excludes never-imported files; consult files with loaded=false.',
      'Unloaded files have null metrics: executable line/branch totals were not measured.',
      'V8 metrics include module initialization and transpiler helpers; high coverage alone does not prove assertions or browser behavior.',
      'DOM tests do not prove real browser layout, GPU inference, OS notifications, PostgreSQL concurrency or provider availability.',
    ] };
}

export function coverageSummary(report: Awaited<ReturnType<typeof buildCoverageReport>>) {
  const pct = (value: Metric) => value.percent === null ? 'not measured' : `${value.percent.toFixed(2)}%`;
  const weak = report.files.filter(file => file.measured).sort((a, b) => a.measured!.lines.percent! - b.measured!.lines.percent!).slice(0, 10);
  const absent = report.files.filter(file => !file.loaded);
  return [
    `Coverage: ${report.loadedFiles}/${report.runtimeFiles} runtime source files loaded (${report.typeOnlyFiles.length} type-only files excluded).`,
    `Loaded modules only: lines ${pct(report.loadedModuleCoverage.lines)}, branches ${pct(report.loadedModuleCoverage.branches)}, functions ${pct(report.loadedModuleCoverage.functions)}.`,
    'Lowest measured line coverage:', ...weak.map(file => `  ${file.file}: ${pct(file.measured!.lines)}`),
    `Never loaded (${absent.length}; no invented coverage percentage):`, ...absent.map(file => `  ${file.file}`),
    'Reports: coverage/lcov.info and coverage/summary.json', '',
  ].join('\n');
}
