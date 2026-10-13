import { describe, expect, it } from 'vitest';
import { escape, renderReport, summarizeReport } from '../src/markdown.js';
import { report } from './helpers.js';

describe('renderReport', () => {
  it('renders a comparison', () => {
    expect(summarizeReport(report())).toBe('🔴 1 regression');
    expect(renderReport(report())).toMatchInlineSnapshot(`
      "Compared \`bbbbbbb\` against \`aaaaaaa\` on \`main\`, with a 10% threshold.

      | | Benchmark | Base | Current | Change |
      | --- | --- | ---: | ---: | ---: |
      | 🔴 | slow | 100 us | 150 us | **+50.0%** |

      <details><summary>1 unchanged</summary>

      | | Benchmark | Base | Current | Change |
      | --- | --- | ---: | ---: | ---: |
      | ⚪ | steady | 100 us | 100 us | 0.0% |

      </details>"
    `);
  });

  it('renders results without a baseline', () => {
    expect(summarizeReport(report(false))).toBe('No baseline yet');
    const md = renderReport(report(false));
    expect(md).toContain('No results from the same machine');
    expect(md).toContain('| slow | 150 us |');
  });
});

describe('timings alongside instruction counts', () => {
  it('shows both measurements side by side', async () => {
    const { attachTimes, compare } = await import('../src/compare.js');
    const counts = [{ name: 'sort', value: 1_205_000, unit: 'instructions' }];
    const r = {
      ...report(),
      rows: attachTimes(
        compare(counts, counts, 5),
        [{ name: 'sort', value: 1018, unit: 'us' }],
        [{ name: 'sort', value: 831, unit: 'us' }],
        20,
      ),
      time: { threshold: 20, compared: true },
    };
    expect(summarizeReport(r)).toBe('🔴 1 regression');
    expect(renderReport(r)).toMatchInlineSnapshot(`
      "Instruction counts compared \`bbbbbbb\` against \`aaaaaaa\` on \`main\`, with a 10% threshold.

      Timings run alternately with the base commit on the same machine, with a 20% threshold.

      | | Benchmark | Instructions | Change | Time | Change |
      | --- | --- | ---: | ---: | ---: | ---: |
      | 🔴 | sort | 1.205M → 1.205M | 0.0% | 831 us → 1018 us | **+22.5%** |"
    `);
  });

  it('still shows timings when the base could not be counted', async () => {
    const { attachTimes, compare } = await import('../src/compare.js');
    const counts = [{ name: 'sort', value: 1_205_000, unit: 'instructions' }];
    const r = {
      ...report(false),
      rows: attachTimes(compare(counts, undefined, 5), [{ name: 'sort', value: 100, unit: 'us' }], [
        { name: 'sort', value: 99, unit: 'us' },
      ], 20),
      time: { threshold: 20, compared: true },
    };
    expect(summarizeReport(r)).toBe('✅ No significant changes');
    expect(renderReport(r)).toContain('| ⚪ | sort | 1.205M | – | 99 us → 100 us | +1.0% |');
  });
});

describe('baseline wording', () => {
  it('says when the base was benchmarked in the same job', () => {
    const r = report();
    r.baseline!.source = 'rerun';
    expect(renderReport(r)).toContain('on `main`, benchmarked on the same machine, with');
  });
  it('explains a failed base run', () => {
    const r = { ...report(false), baselineError: 'Could not benchmark the base commit aaaaaaa: exit 1' };
    expect(renderReport(r)).toContain('⚠️ Could not benchmark the base commit aaaaaaa: exit 1');
  });
});

describe('formatValue', () => {
  it('keeps large counts readable', async () => {
    const { formatValue } = await import('../src/markdown.js');
    expect(formatValue(383487, 'instructions')).toBe('383.5K instructions');
    expect(formatValue(12_345_678, '')).toBe('12.35M');
    expect(formatValue(1234.5, 'us')).toBe('1234.5 us');
  });
});

describe('escape', () => {
  it('neutralizes tables, html and mentions', () => {
    expect(escape('a|b')).toBe('a\\|b');
    expect(escape('<img src=x>')).toBe('\\<img src=x\\>');
    expect(escape('@octocat')).toBe('@​octocat');
    expect(escape('line\nbreak')).toBe('line break');
  });
});
