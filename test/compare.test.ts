import { describe, expect, it } from 'vitest';
import { compare, parseThreshold, regressions } from '../src/compare.js';
import type { Report } from '../src/types.js';

describe('parseThreshold', () => {
  it('accepts plain numbers and percentages', () => {
    expect(parseThreshold('10%')).toBe(10);
    expect(parseThreshold(' 2.5 % ')).toBe(2.5);
    expect(parseThreshold('0')).toBe(0);
    expect(() => parseThreshold('-1')).toThrow();
    expect(() => parseThreshold('ten')).toThrow();
    expect(() => parseThreshold('')).toThrow();
  });
});

describe('compare', () => {
  const base = [
    { name: 'slower', value: 100, unit: 'us' },
    { name: 'faster', value: 100, unit: 'us' },
    { name: 'same', value: 100, unit: 'us' },
    { name: 'gone', value: 1, unit: 'us' },
    { name: 'throughput', value: 100, unit: 'ops', lowerIsBetter: false },
  ];
  const current = [
    { name: 'slower', value: 120, unit: 'us' },
    { name: 'faster', value: 80, unit: 'us' },
    { name: 'same', value: 105, unit: 'us' },
    { name: 'added', value: 1, unit: 'us' },
    { name: 'throughput', value: 80, unit: 'ops', lowerIsBetter: false },
  ];

  it('classifies each benchmark against the threshold', () => {
    const rows = compare(current, base, 10);
    const status = Object.fromEntries(rows.map((r) => [r.name, r.status]));
    expect(status).toEqual({
      slower: 'regression',
      faster: 'improvement',
      same: 'unchanged',
      added: 'new',
      throughput: 'regression',
      gone: 'removed',
    });
    expect(rows.find((r) => r.name === 'slower')?.changePercent).toBeCloseTo(20);
    expect(rows.find((r) => r.name === 'throughput')?.changePercent).toBeCloseTo(-20);
  });

  it('marks everything new without a baseline', () => {
    expect(compare(current, undefined, 10).every((r) => r.status === 'new')).toBe(true);
  });

  it('re-checks regressions with another threshold', () => {
    const report: Report = {
      version: 1,
      suite: 'default',
      threshold: 10,
      current: { sha: 'b', ref: 'x' },
      baseline: { sha: 'a', branch: 'main' },
      rows: compare(current, base, 10),
    };
    expect(regressions(report).map((r) => r.name).sort()).toEqual(['slower', 'throughput']);
    expect(regressions(report, 25)).toEqual([]);
    expect(regressions(report, 1).map((r) => r.name).sort()).toEqual(['same', 'slower', 'throughput']);
    expect(regressions({ ...report, baseline: undefined })).toEqual([]);
  });
});
