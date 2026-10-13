import { suitePath } from './history.js';
import { escape, renderReport, shortSha, summarizeReport } from './markdown.js';
import type { Report } from './types.js';

/**
 * Every suite shares one pull request comment. Its full state is stored in
 * a hidden HTML comment so each writer (one job per suite, plus the
 * workflow_run comment job for forks) can merge its part and re-render.
 */
export const commentMarker = '<!-- benchmark-action:comment -->';
const statePattern = /<!-- benchmark-action:state:([A-Za-z0-9+/=]+) -->/;
const maxBodyLength = 60_000;

export interface Head {
  sha: string;
  runUrl?: string;
  /** Set once the benchmark workflow run for this commit completed. */
  finished?: boolean;
}

export type SuiteState =
  | { status: 'running'; sha: string; runUrl?: string; previous?: Report }
  | { status: 'done'; sha: string; runUrl?: string; report: Report }
  | { status: 'failed'; sha: string; runUrl?: string; message: string; previous?: Report };

export interface CommentState {
  version: 1;
  head?: Head;
  suites: Record<string, SuiteState>;
}

export function emptyState(): CommentState {
  return { version: 1, suites: {} };
}

/** Records that benchmarks started for a new commit (or a re-run). */
export function startHead(state: CommentState, sha: string, runUrl?: string): void {
  if (state.head?.sha !== sha || (runUrl && state.head.runUrl !== runUrl)) {
    state.head = { sha, runUrl: runUrl ?? (state.head?.sha === sha ? state.head.runUrl : undefined) };
  }
}

export function startSuite(state: CommentState, suite: string, sha: string, runUrl?: string): void {
  startHead(state, sha, runUrl);
  state.suites[suite] = { status: 'running', sha, runUrl, previous: latestReport(state.suites[suite]) };
}

/** Stores a suite's results. Returns false when they are for an outdated commit. */
export function finishSuite(state: CommentState, report: Report, runUrl?: string): boolean {
  const sha = report.current.sha;
  if (state.head && state.head.sha !== sha) return false;
  state.head ??= { sha, runUrl };
  state.suites[report.suite] = { status: 'done', sha, runUrl, report };
  return true;
}

export function failSuite(
  state: CommentState,
  suite: string,
  sha: string,
  message: string,
  runUrl?: string,
): boolean {
  if (state.head && state.head.sha !== sha) return false;
  state.head ??= { sha, runUrl };
  state.suites[suite] = { status: 'failed', sha, runUrl, message, previous: latestReport(state.suites[suite]) };
  return true;
}

/**
 * Records that the benchmark run for `sha` completed. Suites still running
 * for that commit never reported, so they are marked as failed.
 */
export function finishHead(state: CommentState, sha: string, conclusion: string, runUrl?: string): void {
  if (state.head?.sha !== sha) return;
  state.head.finished = true;
  if (runUrl) state.head.runUrl = runUrl;
  for (const [suite, s] of Object.entries(state.suites)) {
    if (s.status === 'running' && s.sha === sha) {
      failSuite(state, suite, sha, `The benchmark run ended (${conclusion}) without reporting results.`, runUrl ?? s.runUrl);
    }
  }
}

function latestReport(suite: SuiteState | undefined): Report | undefined {
  if (!suite) return undefined;
  return suite.status === 'done' ? suite.report : suite.previous;
}

type View =
  | { kind: 'running'; previous?: Report; runUrl?: string }
  | { kind: 'done'; report: Report; runUrl?: string }
  | { kind: 'failed'; message: string; previous?: Report; runUrl?: string }
  | { kind: 'missing'; previous?: Report };

/** What to show for a suite, given the commit currently being benchmarked. */
function view(state: CommentState, suite: SuiteState): View {
  const head = state.head;
  if (head && suite.sha !== head.sha) {
    const previous = latestReport(suite);
    return head.finished ? { kind: 'missing', previous } : { kind: 'running', previous, runUrl: head.runUrl };
  }
  switch (suite.status) {
    case 'running':
      return { kind: 'running', previous: suite.previous, runUrl: suite.runUrl };
    case 'done':
      return { kind: 'done', report: suite.report, runUrl: suite.runUrl };
    case 'failed':
      return { kind: 'failed', message: suite.message, previous: suite.previous, runUrl: suite.runUrl };
  }
}

export function renderComment(state: CommentState, options: { compact?: boolean } = {}): string {
  const head = state.head;
  const names = Object.keys(state.suites).sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
  );
  const views = names.map((name) => [name, view(state, state.suites[name])] as const);
  const running = views.some(([, v]) => v.kind === 'running') || (names.length === 0 && !head?.finished);

  const lines: string[] = [commentMarker, '## Benchmarks', ''];
  if (head) {
    const run = head.runUrl ? ` ([run](${head.runUrl}))` : '';
    lines.push(
      running
        ? `⏳ Running benchmarks for ${shortSha(head.sha)}${run}…`
        : `Results for ${shortSha(head.sha)}${run}.`,
      '',
    );
  }
  if (names.length === 0 && head?.finished) {
    lines.push('The benchmark run finished without reporting any results.', '');
  }

  const single = names.length === 1 && names[0] === 'default';
  for (const [name, v] of views) {
    const title = single ? '' : `**${escape(name)}**: `;
    switch (v.kind) {
      case 'running':
        lines.push(`### ${title}⏳ Running…`, '');
        break;
      case 'done':
        lines.push(`### ${title}${summarizeReport(v.report)}`, '', renderReport(v.report), '');
        break;
      case 'failed':
        lines.push(
          `### ${title}❌ Failed`,
          '',
          `${escape(v.message)}${v.runUrl ? ` See the [run](${v.runUrl}).` : ''}`,
          '',
        );
        break;
      case 'missing':
        lines.push(`### ${title}⚪ Not run for this commit`, '');
        break;
    }
    if (v.kind !== 'done' && v.previous && !options.compact) {
      lines.push(
        `<details><summary>Previous results for ${shortSha(v.previous.current.sha)}</summary>`,
        '',
        renderReport(v.previous),
        '',
        '</details>',
        '',
      );
    }
  }

  const siteUrl = names
    .map((n) => latestReport(state.suites[n])?.siteUrl)
    .find((url): url is string => !!url);
  if (siteUrl) lines.push(`[View history](${siteUrl})`, '');

  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  lines.push(`<!-- benchmark-action:state:${encoded} -->`);
  return lines.join('\n') + '\n';
}

/**
 * Renders the comment, shrinking the state if needed to stay under
 * GitHub's comment size limit: previous results go first, then unchanged rows.
 */
export function renderCommentWithinLimit(state: CommentState): string {
  let body = renderComment(state);
  if (body.length <= maxBodyLength) return body;
  const slim: CommentState = structuredClone(state);
  for (const s of Object.values(slim.suites)) if (s.status !== 'done') delete s.previous;
  body = renderComment(slim, { compact: true });
  if (body.length <= maxBodyLength) return body;
  for (const s of Object.values(slim.suites)) {
    if (s.status === 'done') s.report.rows = s.report.rows.filter((r) => r.status !== 'unchanged');
  }
  return renderComment(slim, { compact: true });
}

/** Reads the state back from a comment body, ignoring anything malformed. */
export function parseState(body: string | undefined): CommentState {
  const match = body && statePattern.exec(body);
  if (!match) return emptyState();
  try {
    const data = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as CommentState;
    validateState(data);
    return data;
  } catch {
    return emptyState();
  }
}

const sha = /^[0-9a-f]{4,64}$/;
const url = /^https:\/\/[^\s()<>]+$/;

function validateState(state: CommentState): void {
  if (state?.version !== 1 || typeof state.suites !== 'object' || state.suites === null) {
    throw new Error('Malformed comment state.');
  }
  if (state.head) {
    check(sha.test(state.head.sha), 'head sha');
    check(state.head.runUrl === undefined || url.test(state.head.runUrl), 'run url');
  }
  // Drop a malformed suite rather than the whole state, so one bad entry
  // cannot wipe the other suites' results.
  for (const [name, s] of Object.entries(state.suites)) {
    try {
      validateSuite(name, s);
    } catch {
      delete state.suites[name];
    }
  }
}

function validateSuite(name: string, s: SuiteState): void {
  suitePath(name);
  check(sha.test(s.sha), 'suite sha');
  check(s.runUrl === undefined || url.test(s.runUrl), 'run url');
  if (s.status === 'done') validateReport(s.report);
  else if (s.status === 'running' || s.status === 'failed') {
    if (s.previous) validateReport(s.previous);
    if (s.status === 'failed') check(typeof s.message === 'string', 'message');
  } else throw new Error('Malformed suite status.');
}

/** Checks the shape of a report that may come from untrusted code. */
export function validateReport(report: Report): void {
  check(report?.version === 1 && Array.isArray(report.rows) && typeof report.suite === 'string', 'report');
  suitePath(report.suite);
  check(typeof report.threshold === 'number', 'threshold');
  check(sha.test(report.current?.sha) && typeof report.current.ref === 'string', 'current');
  if (report.baseline) {
    check(sha.test(report.baseline.sha) && typeof report.baseline.branch === 'string', 'baseline');
  }
  check(report.siteUrl === undefined || url.test(report.siteUrl), 'site url');
  check(report.baselineError === undefined || typeof report.baselineError === 'string', 'baseline error');
  check(report.machine === undefined || typeof report.machine === 'string', 'machine');
  check(
    report.baseline?.source === undefined || ['stored', 'rerun'].includes(report.baseline.source),
    'baseline source',
  );
  const statuses = ['regression', 'improvement', 'unchanged', 'new', 'removed'];
  for (const row of report.rows) {
    check(typeof row.name === 'string' && typeof row.unit === 'string', 'row');
    check(statuses.includes(row.status) && typeof row.lowerIsBetter === 'boolean', 'row status');
    for (const key of ['base', 'current', 'changePercent'] as const) {
      check(row[key] === undefined || typeof row[key] === 'number', 'row value');
    }
  }
}

function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(`Malformed ${what}.`);
}
