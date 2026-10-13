import { describe, expect, it } from 'vitest';
import { alternatingOrder, medianBenchmarks } from '../src/samples.js';
import type { Benchmark } from '../src/types.js';

describe('medianBenchmarks', () => {
  it('takes the median of each benchmark across runs', () => {
    const runs: Benchmark[][] = [
      [{ name: 'a', value: 10, unit: 'us' }, { name: 'b', value: 1, unit: '' }],
      [{ name: 'a', value: 30, unit: 'us' }, { name: 'b', value: 2, unit: '' }],
      [{ name: 'a', value: 11, unit: 'us' }],
    ];
    expect(medianBenchmarks(runs)).toEqual([
      { name: 'a', value: 11, unit: 'us' },
      { name: 'b', value: 1.5, unit: '' },
    ]);
  });
});

describe('alternatingOrder', () => {
  it('runs each side the same number of times, balanced over time', () => {
    expect(alternatingOrder(3)).toEqual([0, 1, 1, 0, 0, 1]);
    const order = alternatingOrder(5);
    expect(order.filter((x) => x === 0)).toHaveLength(5);
    expect(order.filter((x) => x === 1)).toHaveLength(5);
  });
});
