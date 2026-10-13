import type { Benchmark } from './types.js';

export type Format = 'json' | 'dart';

export const formats: readonly Format[] = ['json', 'dart'];

export function parseResults(content: string, format: Format): Benchmark[] {
  const benchmarks = format === 'dart' ? parseDart(content) : parseJson(content);
  if (benchmarks.length === 0) {
    throw new Error(`No benchmark results found in the ${format} output.`);
  }
  const seen = new Set<string>();
  for (const b of benchmarks) {
    if (seen.has(b.name)) throw new Error(`Duplicate benchmark name "${b.name}".`);
    seen.add(b.name);
  }
  return benchmarks;
}

/**
 * Accepts either `[{ name, value, unit }]` or `{ "benchmarks": [...] }`.
 */
export function parseJson(content: string): Benchmark[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error(`Results file is not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.benchmarks)
      ? data.benchmarks
      : undefined;
  if (!list) {
    throw new Error('Results JSON must be an array or an object with a "benchmarks" array.');
  }

  return list.map((item, i): Benchmark => {
    const where = `benchmarks[${i}]`;
    if (!isObject(item)) throw new Error(`${where} must be an object.`);
    const { name, value, unit, lowerIsBetter } = item;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`${where}.name must be a non-empty string.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${where}.value must be a finite number.`);
    }
    if (unit !== undefined && typeof unit !== 'string') {
      throw new Error(`${where}.unit must be a string.`);
    }
    if (lowerIsBetter !== undefined && typeof lowerIsBetter !== 'boolean') {
      throw new Error(`${where}.lowerIsBetter must be a boolean.`);
    }
    const result: Benchmark = { name: name.trim(), value, unit: unit ?? '' };
    if (lowerIsBetter === false) result.lowerIsBetter = false;
    return result;
  });
}

// benchmark_harness prints lines such as `Template(RunTime): 12.5 us.`
// Newer versions may also emit other metrics, e.g. `Foo(RunTimeRaw): 3 ns.`
const dartLine =
  /^(?<name>.+?)\((?<metric>[A-Za-z]+)\):\s*(?<value>[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(?<unit>[^\s.]+)?\.?\s*$/;

export function parseDart(content: string): Benchmark[] {
  const benchmarks: Benchmark[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const match = dartLine.exec(raw.trim());
    if (!match?.groups) continue;
    const { name, metric, value, unit } = match.groups;
    benchmarks.push({
      name: metric === 'RunTime' ? name.trim() : `${name.trim()} (${metric})`,
      value: Number(value),
      unit: unit ?? 'us',
    });
  }
  return benchmarks;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
