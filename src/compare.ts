import type { Benchmark, Report, ReportRow } from './types.js';

/** Parses `10`, `10%` or `1.5 %` into a number of percent. */
export function parseThreshold(input: string): number {
  const value = Number(input.trim().replace(/%$/, '').trim());
  if (input.trim() === '' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid threshold "${input}". Use a percentage such as "10%".`);
  }
  return value;
}

/**
 * How much worse `current` is than `base`, in percent. Positive means a
 * regression, negative an improvement, whatever the benchmark's direction.
 */
export function worsePercent(row: Pick<ReportRow, 'base' | 'current' | 'lowerIsBetter'>): number | undefined {
  if (row.base === undefined || row.current === undefined) return undefined;
  if (row.base === 0) return row.current === 0 ? 0 : undefined;
  const change = ((row.current - row.base) / Math.abs(row.base)) * 100;
  return row.lowerIsBetter ? change : -change;
}

export function classify(row: Omit<ReportRow, 'status'>, threshold: number): ReportRow['status'] {
  if (row.base === undefined) return 'new';
  if (row.current === undefined) return 'removed';
  const worse = worsePercent(row);
  if (worse === undefined) return 'unchanged';
  if (worse > threshold) return 'regression';
  if (worse < -threshold) return 'improvement';
  return 'unchanged';
}

export function compare(
  current: Benchmark[],
  baseline: Benchmark[] | undefined,
  threshold: number,
): ReportRow[] {
  const baseByName = new Map((baseline ?? []).map((b) => [b.name, b]));
  const rows: ReportRow[] = current.map((b) => {
    const base = baseByName.get(b.name);
    baseByName.delete(b.name);
    const row: Omit<ReportRow, 'status'> = {
      name: b.name,
      unit: b.unit,
      lowerIsBetter: b.lowerIsBetter ?? true,
      base: base?.value,
      current: b.value,
    };
    if (base !== undefined && base.value !== 0) {
      row.changePercent = ((b.value - base.value) / Math.abs(base.value)) * 100;
    }
    return { ...row, status: baseline ? classify(row, threshold) : 'new' };
  });
  for (const removed of baseByName.values()) {
    rows.push({
      name: removed.name,
      unit: removed.unit,
      lowerIsBetter: removed.lowerIsBetter ?? true,
      base: removed.value,
      status: 'removed',
    });
  }
  return rows;
}

/** Re-evaluates a report's rows against a (possibly different) threshold. */
export function regressions(report: Report, threshold = report.threshold): ReportRow[] {
  if (!report.baseline) return [];
  return report.rows.filter((row) => classify(row, threshold) === 'regression');
}
