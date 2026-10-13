import * as core from '@actions/core';
import { readFile } from 'node:fs/promises';
import { parseThreshold, regressions } from './compare.js';
import type { Report } from './types.js';

async function main(): Promise<void> {
  const reportPath = core.getInput('report') || process.env.BENCHMARK_REPORT;
  if (!reportPath) {
    throw new Error('No report found. Run rrousselgit/benchmark first, or pass its "report" output.');
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Report;
  const thresholdInput = core.getInput('threshold');
  const threshold = thresholdInput ? parseThreshold(thresholdInput) : report.threshold;
  const timeThresholdInput = core.getInput('time-threshold');
  const timeThreshold = timeThresholdInput ? parseThreshold(timeThresholdInput) : report.time?.threshold;

  if (!report.baseline && !report.time?.compared) {
    core.notice('No baseline results to compare against, so there is nothing to check.');
    core.setOutput('regressions', 0);
    return;
  }

  const failing = regressions(report, threshold, timeThreshold);
  core.setOutput('regressions', failing.length);
  const limits = timeThreshold === undefined ? `${threshold}%` : `${threshold}% (${timeThreshold}% for time)`;
  if (failing.length === 0) {
    core.info(`No benchmark regressed by more than ${limits}.`);
    return;
  }
  const lines = failing.map(
    (r) => `  ${r.name}: ${r.base} → ${r.current} ${r.unit} (${r.worsePercent.toFixed(1)}% worse)`,
  );
  core.setFailed(`${failing.length} measurement(s) regressed by more than ${limits}:\n${lines.join('\n')}`);
}

main().catch((e: Error) => core.setFailed(e.message));
