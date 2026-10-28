import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCoverageReport, parseLcov, COVERAGE_ROOTS } from '../scripts/coverageReport.ts';

test('LCOV merging keeps uncovered lines/branches/functions and does not count outside dependencies', () => {
  const result = parseLcov('SF:src/used.ts\nDA:1,2\nDA:2,0\nBRDA:1,0,0,-\nBRDA:1,0,1,3\nFNDA:0,unused\nFNDA:2,used\nend_of_record\nSF:src/used.ts\nDA:2,1\nend_of_record\nSF:node_modules/package/index.js\nDA:1,1\nend_of_record\nSF:../src/outside.ts\nDA:1,1\nend_of_record', '/workspace');
  assert.equal(result.size, 1); assert.equal(result.get('src/used.ts')!.lines.percent, 100);
  assert.equal(result.get('src/used.ts')!.branches.percent, 50); assert.equal(result.get('src/used.ts')!.functions.percent, 50);
  assert.throws(() => parseLcov('SF:src/used.ts\nDA:1,invalid', '/workspace'));
});

test('coverage inventory exposes never-loaded runtime files, excludes type-only modules and never executes source', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'trafficpulse-coverage-'));
  try {
    for (const directory of COVERAGE_ROOTS) await mkdir(path.join(root, directory));
    await writeFile(path.join(root, 'src/used.ts'), 'export function used() { return 1; }');
    await writeFile(path.join(root, 'src/unloaded.tsx'), 'throw new Error("source must not execute"); export default () => <p>View</p>;');
    await writeFile(path.join(root, 'src/types.ts'), 'import { Used } from "./used"; export interface Model { id: Used }; export type Id = string;');
    const report = await buildCoverageReport('SF:src/used.ts\nDA:1,1\nFNDA:1,used\nend_of_record', root, 0);
    assert.equal(report.runtimeFiles, 2); assert.equal(report.loadedFiles, 1); assert.deepEqual(report.typeOnlyFiles, ['src/types.ts']);
    assert.equal(report.files.find(file => file.file === 'src/unloaded.tsx')!.measured, null);
    assert.equal(report.loadedModuleCoverage.lines.percent, 100); assert.equal(report.testExitCode, 0);
    const failed = await buildCoverageReport('SF:src/used.ts\nDA:1,0\nend_of_record', root, 1);
    assert.equal(failed.testExitCode, 1); assert.equal(failed.loadedModuleCoverage.lines.percent, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
