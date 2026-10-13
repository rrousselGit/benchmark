import { describe, expect, it } from 'vitest';
import {
  addEntry,
  branchFileName,
  emptyIndex,
  findBaseline,
  findReferenceBaseline,
  historyPath,
  registerBranch,
  scaleToMachine,
} from '../src/history.js';
import type { Entry } from '../src/types.js';

const entry = (sha: string, value = 1, machine = 'm1'): Entry => ({
  commit: { sha, message: sha, author: 'me', timestamp: '2026-01-01T00:00:00Z', url: `u/${sha}` },
  branch: 'main',
  runAt: '2026-01-01T00:00:00Z',
  machine,
  benchmarks: [{ name: 'a', value, unit: 'us' }],
});

describe('branch files', () => {
  it('slugs branch names and avoids collisions', () => {
    expect(branchFileName('main')).toBe('main.json');
    expect(branchFileName('feature/x')).toBe('feature_x.json');
    expect(branchFileName('../evil')).toBe('__evil.json');
    const index = emptyIndex();
    registerBranch(index, 'default', 'feature/x');
    registerBranch(index, 'default', 'feature_x');
    registerBranch(index, 'default', 'feature/x');
    expect(index.suites.default.branches).toEqual({
      'feature/x': 'feature_x.json',
      feature_x: 'feature_x-2.json',
    });
    expect(historyPath(index, 'default', 'feature_x')).toBe('data/default/feature_x-2.json');
    expect(() => historyPath(index, '../x', 'main')).toThrow(/Invalid suite/);
  });
});

describe('addEntry', () => {
  it('appends, replaces reruns and trims', () => {
    let h = { suite: 'default', branch: 'main', entries: [] as Entry[] };
    h = addEntry(h, entry('a'), 0);
    h = addEntry(h, entry('b'), 0);
    h = addEntry(h, entry('a', 2), 0);
    expect(h.entries.map((e) => [e.commit.sha, e.benchmarks[0].value])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    h = addEntry(h, entry('c'), 2);
    expect(h.entries.map((e) => e.commit.sha)).toEqual(['b', 'c']);
    h = addEntry(h, entry('c', 5, 'm2'), 0);
    expect(h.entries.map((e) => `${e.commit.sha}@${e.machine}`)).toEqual(['b@m1', 'c@m1', 'c@m2']);
  });
});

describe('findBaseline', () => {
  const entries = [entry('a'), entry('b'), entry('c')];
  it('prefers the nearest benchmarked ancestor', () => {
    expect(findBaseline(entries, ['x', 'b', 'a'], 'm1')?.commit.sha).toBe('b');
  });
  it('skips the commit itself', () => {
    expect(findBaseline(entries, ['c', 'b'], 'm1', 'c')?.commit.sha).toBe('b');
  });
  it('only uses results from the same machine', () => {
    const mixed = [entry('a', 1, 'm1'), entry('b', 1, 'm2')];
    expect(findBaseline(mixed, ['b', 'a'], 'm1')?.commit.sha).toBe('a');
    expect(findBaseline(mixed, ['b', 'a'], 'm3')).toBeUndefined();
    expect(findBaseline([{ ...entry('a'), machine: undefined }], ['a'], 'm1')).toBeUndefined();
  });
  it('falls back to the latest entry', () => {
    expect(findBaseline(entries, ['x', 'y'], 'm1')?.commit.sha).toBe('c');
    expect(findBaseline(entries, ['x'], 'm1', 'c')?.commit.sha).toBe('b');
    expect(findBaseline([], ['x'], 'm1')).toBeUndefined();
  });
});

describe('reference', () => {
  const withRef = (sha: string, value: number, ref: string, refValue: number, machine: string): Entry => ({
    ...entry(sha, value, machine),
    reference: { sha: ref, benchmarks: [{ name: 'a', value: refValue, unit: 'us' }] },
  });

  it('finds the nearest ancestor measured against the same reference, on any machine', () => {
    const entries = [withRef('a', 1, 'r', 1, 'm1'), withRef('b', 1, 'other', 1, 'm2'), withRef('c', 1, 'r', 1, 'm3')];
    expect(findReferenceBaseline(entries, ['d', 'c', 'b', 'a'], 'r', 'd')?.commit.sha).toBe('c');
    expect(findReferenceBaseline(entries, ['b', 'a'], 'r')?.commit.sha).toBe('a');
    expect(findReferenceBaseline(entries, ['x'], 'r')).toBeUndefined();
  });

  it('scales a baseline from a slower machine to the current one', () => {
    // Previous run: 120 on a machine where the reference took 100 (20% slower than the reference).
    const before = withRef('a', 120, 'r', 100, 'slow');
    // Current run: the reference takes 80 here, so the baseline becomes 96.
    const now = withRef('b', 96, 'r', 80, 'fast');
    expect(scaleToMachine(before, now)).toEqual([{ name: 'a', value: 96, unit: 'us' }]);
    expect(scaleToMachine(before, { ...now, reference: undefined })).toEqual([]);
  });
});
