import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseResults } from '../src/parse.js';

describe('json', () => {
  it('accepts an array or a "benchmarks" object', () => {
    const list = [{ name: 'a', value: 1, unit: 'ms' }];
    expect(parseResults(JSON.stringify(list), 'json')).toEqual(list);
    expect(parseResults(JSON.stringify({ benchmarks: list }), 'json')).toEqual(list);
  });

  it('keeps lowerIsBetter only when false', () => {
    const parsed = parseResults(
      JSON.stringify([
        { name: 'ops', value: 5, unit: 'ops/s', lowerIsBetter: false },
        { name: 'time', value: 5, lowerIsBetter: true },
      ]),
      'json',
    );
    expect(parsed).toEqual([
      { name: 'ops', value: 5, unit: 'ops/s', lowerIsBetter: false },
      { name: 'time', value: 5, unit: '' },
    ]);
  });

  it('rejects invalid input', () => {
    expect(() => parseResults('nope', 'json')).toThrow(/not valid JSON/);
    expect(() => parseResults('{}', 'json')).toThrow(/array/);
    expect(() => parseResults('[]', 'json')).toThrow(/No benchmark results/);
    expect(() => parseResults('[{"name":"a","value":"1"}]', 'json')).toThrow(/value must be a finite number/);
    expect(() => parseResults('[{"name":"","value":1}]', 'json')).toThrow(/name/);
    expect(() =>
      parseResults('[{"name":"a","value":1},{"name":"a","value":2}]', 'json'),
    ).toThrow(/Duplicate/);
  });
});

describe('dart', () => {
  it('parses benchmark_harness output', () => {
    const content = readFileSync(new URL('./fixtures/dart-output.txt', import.meta.url), 'utf8');
    expect(parseResults(content, 'dart')).toEqual([
      { name: 'Template', value: 12.5, unit: 'us' },
      { name: 'ListCopy', value: 0.034, unit: 'us' },
      { name: 'Big', value: 1200, unit: 'us' },
      { name: 'Raw (RunTimeRaw)', value: 340, unit: 'ns' },
      { name: 'Fibonacci recursive (20)', value: 611.607, unit: 'us' },
    ]);
  });

  it('fails when nothing matches', () => {
    expect(() => parseResults('hello', 'dart')).toThrow(/No benchmark results/);
  });
});
