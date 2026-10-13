import type { Report, ReportRow } from './types.js';

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

export function shortSha(sha: string): string {
  return `\`${sha.slice(0, 7)}\``;
}

/** One-line outcome of a report, such as "🔴 1 regression · 🟢 2 improvements". */
export function summarizeReport(report: Report): string {
  if (!report.baseline) return 'No baseline yet';
  const counts = { regression: 0, improvement: 0, unchanged: 0, new: 0, removed: 0 };
  for (const row of report.rows) counts[row.status]++;
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (counts.regression) parts.push(`🔴 ${plural(counts.regression, 'regression')}`);
  if (counts.improvement) parts.push(`🟢 ${plural(counts.improvement, 'improvement')}`);
  if (counts.new) parts.push(`🆕 ${counts.new} new`);
  if (counts.removed) parts.push(`➖ ${counts.removed} removed`);
  return parts.length === 0 ? '✅ No significant changes' : parts.join(' · ');
}

/**
 * Renders a report's details as GitHub markdown: what it was compared to,
 * then the tables. Benchmark names may come from fork pull requests, so
 * everything user-controlled goes through `escape`.
 */
export function renderReport(report: Report): string {
  const lines: string[] = [];
  if (report.baseline) {
    const where = report.baseline.source === 'rerun' ? ', benchmarked on the same machine' : '';
    lines.push(
      `Compared ${shortSha(report.current.sha)} against ${shortSha(report.baseline.sha)} on \`${escapeCode(report.baseline.branch)}\`${where}, with a ${report.threshold}% threshold.`,
    );
  } else if (report.baselineError) {
    lines.push(`⚠️ ${escape(report.baselineError)}`);
  } else {
    lines.push(
      `No results from the same machine to compare ${shortSha(report.current.sha)} against yet.`,
    );
  }
  lines.push('');

  const rows = [...report.rows].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name),
  );
  if (!report.baseline) {
    lines.push(...table(rows, false));
    return lines.join('\n');
  }
  const changed = rows.filter((r) => r.status !== 'unchanged');
  const unchanged = rows.filter((r) => r.status === 'unchanged');
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
  return lines.join('\n');
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
  return row.status === 'regression' ? `**${text}**` : text;
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

export function escapeCode(text: string): string {
  return text.slice(0, 200).replace(/[`\r\n]/g, '');
}
