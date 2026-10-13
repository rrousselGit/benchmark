import type { Benchmark, Report, ReportRow, RowStatus, TimeComparison } from './types.js';

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

/**
 * Attaches timings to instruction count rows, matched by name. Benchmarks
 * missing from the instruction counts get a row of their own.
 */
export function attachTimes(
  rows: ReportRow[],
  current: Benchmark[],
  baseline: Benchmark[] | undefined,
  threshold: number,
): ReportRow[] {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const result = [...rows];
  for (const t of compare(current, baseline, threshold)) {
    const time: TimeComparison = {
      unit: t.unit,
      base: t.base,
      current: t.current,
      changePercent: t.changePercent,
      status: t.status,
    };
    const row = byName.get(t.name);
    if (row) row.time = time;
    else result.push({ name: t.name, unit: '', lowerIsBetter: true, status: 'unchanged', time });
  }
  return result;
}

const severity: Record<RowStatus, number> = { regression: 0, improvement: 1, new: 2, removed: 3, unchanged: 4 };

/** A row's overall status: the most notable of its instruction count and time. */
export function rowStatus(row: ReportRow): RowStatus {
  if (!row.time) return row.status;
  const own = row.base === undefined && row.current === undefined ? 'unchanged' : row.status;
  return severity[row.time.status] < severity[own] ? row.time.status : own;
}

/** A failed regression check: which benchmark, and in which measurement. */
export interface Regression {
  name: string;
  unit: string;
  base: number;
  current: number;
  worsePercent: number;
}

/**
 * Re-evaluates a report against (possibly different) thresholds: instruction
 * counts or timings against `threshold`, attached timings against
 * `timeThreshold`.
 */
export function regressions(
  report: Report,
  threshold = report.threshold,
  timeThreshold = report.time?.threshold,
): Regression[] {
  const out: Regression[] = [];
  const add = (name: string, row: Omit<ReportRow, 'status' | 'name'>, limit: number) => {
    if (classify({ ...row, name }, limit) !== 'regression') return;
    out.push({ name, unit: row.unit, base: row.base!, current: row.current!, worsePercent: worsePercent(row)! });
  };
  for (const row of report.rows) {
    if (report.baseline) add(row.name, row, threshold);
    if (row.time && report.time?.compared && timeThreshold !== undefined) {
      add(row.name, { ...row.time, lowerIsBetter: true }, timeThreshold);
    }
  }
  return out;
}
