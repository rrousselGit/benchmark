import type { Benchmark } from './types.js';

/**
 * Combines several runs of the same benchmarks into one result per name, the
 * median of its values, so a single disturbed run does not move the result.
 */
export function medianBenchmarks(runs: Benchmark[][]): Benchmark[] {
  const byName = new Map<string, { first: Benchmark; values: number[] }>();
  for (const run of runs) {
    for (const b of run) {
      const seen = byName.get(b.name);
      if (seen) seen.values.push(b.value);
      else byName.set(b.name, { first: b, values: [b.value] });
    }
  }
  return [...byName.values()].map(({ first, values }) => ({ ...first, value: median(values) }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The order in which to run two checkouts `samples` times each: A B B A A B…
 * Machines drift over a job (neighbors come and go, clocks change), and this
 * order spreads that drift evenly over both sides instead of favoring
 * whichever runs first.
 */
export function alternatingOrder(samples: number): (0 | 1)[] {
  return Array.from({ length: samples * 2 }, (_, i) => ([0, 1, 1, 0] as const)[i % 4]);
}
