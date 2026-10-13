/** A single measurement, as found in the user's results file. */
export interface Benchmark {
  name: string;
  value: number;
  unit: string;
  /** Defaults to true: most benchmarks measure time. */
  lowerIsBetter?: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
}

/** One stored benchmark run, keyed by commit. */
export interface Entry {
  commit: CommitInfo;
  branch: string;
  runAt: string;
  benchmarks: Benchmark[];
}

/** File stored at `data/<suite>/<branch file>.json` on the data branch. */
export interface BranchHistory {
  suite: string;
  branch: string;
  entries: Entry[];
}

/** File stored at `data/index.json` on the data branch. */
export interface DataIndex {
  version: 1;
  suites: Record<string, { branches: Record<string, string> }>;
}

export type RowStatus = 'regression' | 'improvement' | 'unchanged' | 'new' | 'removed';

export interface ReportRow {
  name: string;
  unit: string;
  lowerIsBetter: boolean;
  base?: number;
  current?: number;
  /** Signed relative change of the raw value, in percent. */
  changePercent?: number;
  status: RowStatus;
}

export interface Report {
  version: 1;
  suite: string;
  threshold: number;
  current: { sha: string; ref: string };
  baseline?: { sha: string; branch: string };
  pullRequest?: number;
  siteUrl?: string;
  rows: ReportRow[];
}
