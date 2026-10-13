// Tiny benchmark used to exercise this action on its own repository.
// Prints results in the action's JSON format.
import { writeFileSync } from 'node:fs';

const benchmarks = {
  'Array.prototype.map (1k)': () => Array.from({ length: 1000 }, (_, i) => i).map((x) => x * 2),
  'JSON round trip': () => JSON.parse(JSON.stringify({ a: [1, 2, 3], b: { c: 'd' } })),
  'String concat (100)': () => {
    let s = '';
    for (let i = 0; i < 100; i++) s += i;
    return s;
  },
};

// Results are kept alive so the JIT cannot skip the work.
let sink;

function measure(fn) {
  // Warm up for long enough that the JIT has optimized `fn`, then find how
  // many iterations make a sample of about 20ms: samples of a millisecond or
  // less are dominated by timer resolution, GC pauses and interrupts.
  let iterations = 1;
  for (;;) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) sink = fn();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (elapsed >= 20) break;
    iterations *= 2;
  }
  const samples = [];
  for (let run = 0; run < 25; run++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) sink = fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1000 / iterations);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]; // median, in microseconds
}

// The protocol of rrousselgit/benchmark's `mode: instructions`: list the
// benchmarks into a file, or run one of them a given number of times.
const { BENCHMARK_LIST, BENCHMARK_NAME, BENCHMARK_ITERATIONS } = process.env;
if (BENCHMARK_LIST) {
  writeFileSync(BENCHMARK_LIST, Object.keys(benchmarks).map((name) => `${name}\n`).join(''));
} else if (BENCHMARK_NAME) {
  const fn = benchmarks[BENCHMARK_NAME];
  if (!fn) throw new Error(`No benchmark named "${BENCHMARK_NAME}".`);
  const iterations = Number(BENCHMARK_ITERATIONS ?? '1');
  for (let i = 0; i < iterations; i++) sink = fn();
} else {
  const results = Object.entries(benchmarks).map(([name, fn]) => ({ name, value: measure(fn), unit: 'us' }));
  if (sink === undefined) throw new Error('unreachable');
  console.log(JSON.stringify({ benchmarks: results }, null, 2));
}
