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
    expect(md).toContain('No stored results');
    expect(md).toContain('| slow | 150 us |');
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
