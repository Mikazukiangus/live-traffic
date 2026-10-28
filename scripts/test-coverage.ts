import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCoverageReport, coverageSummary, COVERAGE_ROOTS } from './coverageReport.ts';
import { logger } from '../shared/logging.ts';

const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, 'coverage');
async function run() {
  await mkdir(output, { recursive: true });
  // Never leave a stale successful report when the new run cannot generate one.
  for (const name of ['lcov.info', 'summary.json']) await rm(path.join(output, name), { force: true });
  const tests = (await readdir(path.join(root, 'tests'))).filter(name => /\.test\.tsx?$/.test(name)).sort().map(name => 'tests/' + name);
  if (!tests.length) throw new Error('No tests found');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--experimental-test-coverage',
    ...COVERAGE_ROOTS.map(directory => `--test-coverage-include=${directory}/**`),
    '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=lcov', '--test-reporter-destination=coverage/lcov.info',
    '--test', ...tests], { cwd: root, stdio: 'inherit' });
  if (result.error) throw new Error('Coverage process failed');
  const report = await buildCoverageReport(await readFile(path.join(output, 'lcov.info'), 'utf8'), root, result.status ?? 1);
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(coverageSummary(report)); // Report data, not application diagnostics.
  process.exitCode = result.status ?? 1;
}
void run().catch(() => {
  logger.error({ event: 'application_log', code: 'INTERNAL_ERROR', scope: 'script' });
  process.exitCode = 1;
});
