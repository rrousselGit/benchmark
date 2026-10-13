// Tiny benchmark used to exercise this action on its own repository.
// Prints results in the action's JSON format.
const benchmarks = {
  'Array.prototype.map (1k)': () => Array.from({ length: 1000 }, (_, i) => i).map((x) => x * 2),
  'JSON round trip': () => JSON.parse(JSON.stringify({ a: [1, 2, 3], b: { c: 'd' } })),
  'String concat (100)': () => {
    let s = '';
    for (let i = 0; i < 100; i++) s += i;
    return s;
  },
};

function measure(fn) {
  for (let i = 0; i < 1000; i++) fn(); // warm up
  const samples = [];
  for (let run = 0; run < 15; run++) {
    const iterations = 2000;
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1000 / iterations);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]; // median, in microseconds
}

const results = Object.entries(benchmarks).map(([name, fn]) => ({ name, value: measure(fn), unit: 'us' }));
console.log(JSON.stringify({ benchmarks: results }, null, 2));
