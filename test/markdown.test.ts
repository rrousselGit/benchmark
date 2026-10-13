import { describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { commentMarker, escape, renderMarkdown } from '../src/markdown.js';
import type { Report } from '../src/types.js';

const report = (baseline = true): Report => ({
  version: 1,
  suite: 'default',
  threshold: 10,
  current: { sha: 'bbbbbbbbbbbb', ref: 'feature' },
  baseline: baseline ? { sha: 'aaaaaaaaaaaa', branch: 'main' } : undefined,
  siteUrl: 'https://example.github.io/repo/',
  rows: compare(
    [
      { name: 'slow', value: 150, unit: 'us' },
      { name: 'steady', value: 100, unit: 'us' },
    ],
    baseline
      ? [
          { name: 'slow', value: 100, unit: 'us' },
          { name: 'steady', value: 100, unit: 'us' },
        ]
      : undefined,
    10,
  ),
});

describe('renderMarkdown', () => {
  it('renders a comparison', () => {
    expect(renderMarkdown(report())).toMatchInlineSnapshot(`
      "<!-- benchmark-action:default -->
      ### Benchmark results

      Comparing \`bbbbbbb\` against \`aaaaaaa\` on \`main\`, with a 10% threshold.

      🔴 1 regression

      | | Benchmark | Base | Current | Change |
      | --- | --- | ---: | ---: | ---: |
      | 🔴 | slow | 100 us | 150 us | **+50.0%** |

      <details><summary>1 unchanged</summary>

      | | Benchmark | Base | Current | Change |
      | --- | --- | ---: | ---: | ---: |
      | ⚪ | steady | 100 us | 100 us | 0.0% |

      </details>

      [View history](https://example.github.io/repo/)
      "
    `);
  });

  it('renders results without a baseline', () => {
    const md = renderMarkdown(report(false));
    expect(md).toContain('No stored results found');
    expect(md).toContain('| slow | 150 us |');
  });

  it('starts with a per-suite marker', () => {
    expect(renderMarkdown({ ...report(), suite: 'web' }).startsWith(commentMarker('web'))).toBe(true);
    expect(commentMarker('web')).not.toBe(commentMarker('default'));
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
