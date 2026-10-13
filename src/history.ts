import type { BranchHistory, DataIndex, Entry } from './types.js';

export function emptyIndex(): DataIndex {
  return { version: 1, suites: {} };
}

/** Turns any branch name into a safe, readable file name. */
export function branchFileName(branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_');
  return `${slug || '_'}.json`;
}

export function suitePath(suite: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(suite) || suite.startsWith('.')) {
    throw new Error(`Invalid suite "${suite}". Use letters, digits, ".", "_" or "-".`);
  }
  return suite;
}

/** Path of a branch's history file, relative to the data branch root. */
export function historyPath(index: DataIndex, suite: string, branch: string): string {
  const file = index.suites[suite]?.branches[branch] ?? branchFileName(branch);
  return `data/${suitePath(suite)}/${file}`;
}

/** Records a branch in the index, avoiding file name collisions. */
export function registerBranch(index: DataIndex, suite: string, branch: string): void {
  const s = (index.suites[suite] ??= { branches: {} });
  if (s.branches[branch]) return;
  const taken = new Set(Object.values(s.branches));
  let file = branchFileName(branch);
  for (let i = 2; taken.has(file); i++) {
    file = branchFileName(branch).replace(/\.json$/, `-${i}.json`);
  }
  s.branches[branch] = file;
}

/**
 * Adds or replaces the entry for a commit on the same machine (a commit may
 * have results from several machines), keeping entries in the order
 * they were first recorded and trimming the oldest beyond `maxEntries`.
 */
export function addEntry(history: BranchHistory, entry: Entry, maxEntries: number): BranchHistory {
  const entries = [...history.entries];
  const existing = entries.findIndex(
    (e) => e.commit.sha === entry.commit.sha && e.machine === entry.machine,
  );
  if (existing >= 0) entries[existing] = entry;
  else entries.push(entry);
  const trimmed = maxEntries > 0 && entries.length > maxEntries ? entries.slice(-maxEntries) : entries;
  return { ...history, entries: trimmed };
}

/**
 * Picks the stored entry to compare against, among those measured on
 * `machine`. `ancestors` lists commit shas newest first; the first one with
 * stored results wins. Falls back to the most recent matching entry when
 * none of the ancestors were benchmarked on that machine.
 */
export function findBaseline(
  allEntries: Entry[],
  ancestors: string[],
  machine: string,
  exclude?: string,
): Entry | undefined {
  const entries = allEntries.filter((e) => e.machine === machine);
  const bySha = new Map(entries.map((e) => [e.commit.sha, e]));
  for (const sha of ancestors) {
    if (sha === exclude) continue;
    const entry = bySha.get(sha);
    if (entry) return entry;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].commit.sha !== exclude) return entries[i];
  }
  return undefined;
}
