import { rowStatus } from './compare.js';
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
  if (!report.baseline && !report.time?.compared) return 'No baseline yet';
  const counts = { regression: 0, improvement: 0, unchanged: 0, new: 0, removed: 0 };
  for (const row of report.rows) counts[status(report, row)]++;
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (counts.regression) parts.push(`🔴 ${plural(counts.regression, 'regression')}`);
  if (counts.improvement) parts.push(`🟢 ${plural(counts.improvement, 'improvement')}`);
  if (counts.new) parts.push(`🆕 ${counts.new} new`);
  if (counts.removed) parts.push(`➖ ${counts.removed} removed`);
  return parts.length === 0 ? '✅ No significant changes' : parts.join(' · ');
}

/** A row's status, counting only the measurements that have a baseline. */
function status(report: Report, row: ReportRow): ReportRow['status'] {
  if (!report.time) return row.status;
  const counted = { ...row, status: report.baseline ? row.status : 'unchanged' } as ReportRow;
  if (!report.time.compared) delete counted.time;
  return rowStatus(counted);
}

/**
 * Renders a report's details as GitHub markdown: what it was compared to,
 * then the tables. Benchmark names may come from fork pull requests, so
 * everything user-controlled goes through `escape`.
 */
export function renderReport(report: Report): string {
  const lines: string[] = [];
  if (report.baseline) {
    const where =
      report.baseline.source === 'rerun'
        ? ', benchmarked on the same machine'
        : report.baseline.source === 'reference' && report.baseline.reference
          ? ` (base values scaled to this machine through reference ${shortSha(report.baseline.reference)})`
          : '';
    const measured = report.time ? 'Instruction counts compared' : 'Compared';
    lines.push(
      `${measured} ${shortSha(report.current.sha)} against ${shortSha(report.baseline.sha)} on \`${escapeCode(report.baseline.branch)}\`${where}, with a ${report.threshold}% threshold.`,
    );
  } else if (report.baselineError) {
    lines.push(`⚠️ ${escape(report.baselineError)}`);
  } else {
    lines.push(`No results from the same machine to compare ${shortSha(report.current.sha)} against yet.`);
  }
  if (report.time) {
    lines.push(
      '',
      report.time.compared
        ? `Timings run alternately with the base commit on the same machine, with a ${report.time.threshold}% threshold.`
        : `⚠️ Could not time the base commit: ${escape(report.time.error ?? 'unknown error')}`,
    );
  }
  lines.push('');

  const withStatus = report.rows.map((row) => ({ row, status: status(report, row) }));
  withStatus.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.row.name.localeCompare(b.row.name));
  const compared = { instructions: Boolean(report.baseline), time: Boolean(report.time?.compared) };
  const render = (rows: typeof withStatus) =>
    report.time ? timedTable(rows, compared) : table(rows.map((r) => r.row), compared.instructions);
  if (!compared.instructions && !compared.time) {
    lines.push(...render(withStatus));
    return lines.join('\n');
  }
  const changed = withStatus.filter((r) => r.status !== 'unchanged');
  const unchanged = withStatus.filter((r) => r.status === 'unchanged');
  if (changed.length > 0) lines.push(...render(changed));
  if (unchanged.length > 0) {
    if (changed.length > 0) lines.push('');
    lines.push(`<details><summary>${unchanged.length} unchanged</summary>`, '', ...render(unchanged), '', '</details>');
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

/** Instruction counts and timings side by side, one row per benchmark. */
function timedTable(
  rows: { row: ReportRow; status: ReportRow['status'] }[],
  compared: { instructions: boolean; time: boolean },
): string[] {
  const cell = (m: Pick<ReportRow, 'base' | 'current' | 'unit'> | undefined, withBase: boolean) => {
    if (!m || (m.base === undefined && m.current === undefined)) return '–';
    const current = formatValue(m.current, m.unit);
    return withBase ? `${formatValue(m.base, m.unit)} → ${current}` : current;
  };
  const change = (m: Pick<ReportRow, 'changePercent' | 'status'> | undefined, withBase: boolean) =>
    m && withBase ? formatChange(m) : '–';
  return [
    '| | Benchmark | Instructions | Change | Time | Change |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows.map(({ row, status }) => {
      // The column header already says these are instructions.
      const instructions = row.base === undefined && row.current === undefined ? undefined : { ...row, unit: '' };
      return `| ${statusIcon[status]} | ${escape(row.name)} | ${cell(instructions, compared.instructions)} | ${change(instructions, compared.instructions)} | ${cell(row.time, compared.time)} | ${change(row.time, compared.time)} |`;
    }),
  ];
}

// 1.234M, 383.5K: instruction counts get large.
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 4 });

export function formatValue(value: number | undefined, unit: string): string {
  if (value === undefined) return '–';
  const abs = Math.abs(value);
  const text =
    abs >= 1e5
      ? compact.format(value)
      : abs !== 0 && abs < 1e-3
        ? value.toExponential(2)
        : Number(value.toPrecision(abs >= 1000 ? 6 : 4)).toString();
  return unit ? `${text} ${escape(unit)}` : text;
}

function formatChange(row: Pick<ReportRow, 'changePercent' | 'status'>): string {
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
