import { describe, expect, it } from 'vitest';
import { addEntry, branchFileName, emptyIndex, findBaseline, historyPath, registerBranch } from '../src/history.js';
import type { Entry } from '../src/types.js';

const entry = (sha: string, value = 1): Entry => ({
  commit: { sha, message: sha, author: 'me', timestamp: '2026-01-01T00:00:00Z', url: `u/${sha}` },
  branch: 'main',
  runAt: '2026-01-01T00:00:00Z',
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
  });
});

describe('findBaseline', () => {
  const entries = [entry('a'), entry('b'), entry('c')];
  it('prefers the nearest benchmarked ancestor', () => {
    expect(findBaseline(entries, ['x', 'b', 'a'])?.commit.sha).toBe('b');
  });
  it('skips the commit itself', () => {
    expect(findBaseline(entries, ['c', 'b'], 'c')?.commit.sha).toBe('b');
  });
  it('falls back to the latest entry', () => {
    expect(findBaseline(entries, ['x', 'y'])?.commit.sha).toBe('c');
    expect(findBaseline(entries, ['x'], 'c')?.commit.sha).toBe('b');
    expect(findBaseline([], ['x'])).toBeUndefined();
  });
});
