import { compare } from '../src/compare.js';
import type { Report } from '../src/types.js';

export const report = (baseline = true, sha = 'bbbbbbbbbbbb', suite = 'default'): Report => ({
  version: 1,
  suite,
  threshold: 10,
  current: { sha, ref: 'feature' },
  baseline: baseline ? { sha: 'aaaaaaaaaaaa', branch: 'main' } : undefined,
  siteUrl: 'https://example.github.io/repo/',
  rows: compare(
    [
      { name: 'slow', value: 150, unit: 'us' },
      { name: 'steady', value: 100, unit: 'us' },
    ],
    baseline
      ? [
          { name: 'slow', value: 100, unit: 'us' },
          { name: 'steady', value: 100, unit: 'us' },
        ]
      : undefined,
    10,
  ),
});
