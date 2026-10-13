import { worsePercent } from './compare.js';
import type { Report, ReportRow } from './types.js';

export function commentMarker(suite: string): string {
  return `<!-- benchmark-action:${encodeURIComponent(suite)} -->`;
}

const statusOrder: Record<ReportRow['status'], number> = {
  regression: 0,
  improvement: 1,
  new: 2,
  removed: 3,
  unchanged: 4,
};

const statusIcon: Record<ReportRow['status'], string> = {
  regression: '🔴',
  improvement: '🟢',
  new: '🆕',
  removed: '➖',
  unchanged: '⚪',
};

/**
 * Renders a report as GitHub markdown. Benchmark names may come from fork
 * pull requests, so everything user-controlled goes through `escape`.
 */
export function renderMarkdown(report: Report): string {
  const lines: string[] = [commentMarker(report.suite)];
  const title = report.suite === 'default' ? 'Benchmark results' : `Benchmark results: ${escape(report.suite)}`;
  lines.push(`### ${title}`, '');

  const counts = countByStatus(report.rows);
  const short = (sha: string) => `\`${sha.slice(0, 7)}\``;
  if (report.baseline) {
    lines.push(
      `Comparing ${short(report.current.sha)} against ${short(report.baseline.sha)} on \`${escapeCode(report.baseline.branch)}\`, with a ${report.threshold}% threshold.`,
      '',
      summarize(counts),
    );
  } else {
    lines.push(
      `No stored results found for the target branch yet, so there is nothing to compare ${short(report.current.sha)} against.`,
    );
  }
  lines.push('');

  const rows = [...report.rows].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name),
  );
  const changed = rows.filter((r) => r.status !== 'unchanged');
  const unchanged = rows.filter((r) => r.status === 'unchanged');

  if (!report.baseline) {
    lines.push(...table(rows, false));
  } else {
    if (changed.length > 0) lines.push(...table(changed, true));
    if (unchanged.length > 0) {
      if (changed.length > 0) lines.push('');
      lines.push(
        `<details><summary>${unchanged.length} unchanged</summary>`,
        '',
        ...table(unchanged, true),
        '',
        '</details>',
      );
    }
  }

  if (report.siteUrl) {
    lines.push('', `[View history](${report.siteUrl})`);
  }
  return lines.join('\n') + '\n';
}

function table(rows: ReportRow[], withBaseline: boolean): string[] {
  if (!withBaseline) {
    return [
      '| Benchmark | Result |',
      '| --- | ---: |',
      ...rows.map((r) => `| ${escape(r.name)} | ${formatValue(r.current, r.unit)} |`),
    ];
  }
  return [
    '| | Benchmark | Base | Current | Change |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${statusIcon[r.status]} | ${escape(r.name)} | ${formatValue(r.base, r.unit)} | ${formatValue(r.current, r.unit)} | ${formatChange(r)} |`,
    ),
  ];
}

function countByStatus(rows: ReportRow[]): Record<ReportRow['status'], number> {
  const counts = { regression: 0, improvement: 0, unchanged: 0, new: 0, removed: 0 };
  for (const row of rows) counts[row.status]++;
  return counts;
}

function summarize(counts: Record<ReportRow['status'], number>): string {
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (counts.regression) parts.push(`🔴 ${plural(counts.regression, 'regression')}`);
  if (counts.improvement) parts.push(`🟢 ${plural(counts.improvement, 'improvement')}`);
  if (counts.new) parts.push(`🆕 ${counts.new} new`);
  if (counts.removed) parts.push(`➖ ${counts.removed} removed`);
  if (parts.length === 0) return 'No significant changes.';
  return parts.join(' · ');
}

export function formatValue(value: number | undefined, unit: string): string {
  if (value === undefined) return '–';
  const abs = Math.abs(value);
  const text =
    abs !== 0 && (abs >= 1e6 || abs < 1e-3)
      ? value.toExponential(2)
      : Number(value.toPrecision(abs >= 1000 ? 6 : 4)).toString();
  return unit ? `${text} ${escape(unit)}` : text;
}

function formatChange(row: ReportRow): string {
  if (row.changePercent === undefined) return '–';
  const sign = row.changePercent > 0 ? '+' : '';
  const text = `${sign}${row.changePercent.toFixed(1)}%`;
  const worse = worsePercent(row);
  return worse !== undefined && row.status === 'regression' ? `**${text}**` : text;
}

/** Neutralizes markdown, HTML and @mentions in untrusted text. */
export function escape(text: string): string {
  return text
    .slice(0, 200)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​')
    .replace(/&/g, '&amp;');
}

function escapeCode(text: string): string {
  return text.slice(0, 200).replace(/[`\r\n]/g, '');
}
