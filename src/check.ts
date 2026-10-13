import * as core from '@actions/core';
import { readFile } from 'node:fs/promises';
import { parseThreshold, regressions, worsePercent } from './compare.js';
import type { Report } from './types.js';

async function main(): Promise<void> {
  const reportPath = core.getInput('report') || process.env.BENCHMARK_REPORT;
  if (!reportPath) {
    throw new Error('No report found. Run rrousselgit/benchmark first, or pass its "report" output.');
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Report;
  const thresholdInput = core.getInput('threshold');
  const threshold = thresholdInput ? parseThreshold(thresholdInput) : report.threshold;

  if (!report.baseline) {
    core.notice('No baseline results to compare against, so there is nothing to check.');
    core.setOutput('regressions', 0);
    return;
  }

  const failing = regressions(report, threshold);
  core.setOutput('regressions', failing.length);
  if (failing.length === 0) {
    core.info(`No benchmark regressed by more than ${threshold}% against ${report.baseline.sha.slice(0, 7)}.`);
    return;
  }
  const lines = failing.map(
    (r) => `  ${r.name}: ${r.base} → ${r.current} ${r.unit} (${worsePercent(r)!.toFixed(1)}% worse)`,
  );
  core.setFailed(
    `${failing.length} benchmark(s) regressed by more than ${threshold}% against ${report.baseline.sha.slice(0, 7)}:\n${lines.join('\n')}`,
  );
}

main().catch((e: Error) => core.setFailed(e.message));
