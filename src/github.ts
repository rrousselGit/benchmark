import * as core from '@actions/core';
import * as github from '@actions/github';
import { commentMarker, parseState, renderCommentWithinLimit, type CommentState } from './comment-state.js';
import type { BranchHistory, DataIndex } from './types.js';

export type Octokit = ReturnType<typeof github.getOctokit>;

export function repo() {
  return github.context.repo;
}

/** Reads a JSON file from a branch through the API, or undefined if missing. */
export async function readJsonFile<T>(
  octokit: Octokit,
  ref: string,
  path: string,
): Promise<T | undefined> {
  try {
    const res = await octokit.rest.repos.getContent({
      ...repo(),
      ref,
      path,
      mediaType: { format: 'raw' },
    });
    // Raw content usually arrives as a string, but may be parsed already
    // depending on the content type the server sends.
    const data: unknown = res.data;
    if (typeof data === 'string') return JSON.parse(data) as T;
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data)) as T;
    return data as T;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return undefined;
    throw e;
  }
}

export async function readHistory(
  octokit: Octokit,
  dataBranch: string,
  suite: string,
  branch: string,
): Promise<BranchHistory | undefined> {
  const index = await readJsonFile<DataIndex>(octokit, dataBranch, 'data/index.json');
  const file = index?.suites[suite]?.branches[branch];
  if (!file) return undefined;
  return readJsonFile<BranchHistory>(octokit, dataBranch, `data/${suite}/${file}`);
}

/** Shas of `sha` and its first ancestors, newest first. */
export async function ancestors(octokit: Octokit, sha: string, limit = 100): Promise<string[]> {
  try {
    const res = await octokit.rest.repos.listCommits({ ...repo(), sha, per_page: limit });
    return res.data.map((c) => c.sha);
  } catch (e) {
    core.warning(`Could not list the history of ${sha}: ${(e as Error).message}`);
    return [sha];
  }
}

/**
 * Applies `mutate` to the pull request's single benchmark comment, creating
 * it if needed. Several jobs may write at once and GitHub has no conditional
 * updates, so each write is read back and retried if another writer's
 * update replaced it. `mutate` must therefore be idempotent.
 */
export async function updateBenchmarkComment(
  octokit: Octokit,
  pullRequest: number,
  mutate: (state: CommentState) => void,
  attempts = 6,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const existing = await findComments(octokit, pullRequest);
    const target = existing[0];
    const before = parseState(target?.body);
    const state = structuredClone(before);
    mutate(state);
    const changed = changedParts(before, state);
    if (target && changed.length === 0) return;

    const body = renderCommentWithinLimit(state);
    let id: number;
    if (target) {
      await octokit.rest.issues.updateComment({ ...repo(), comment_id: target.id, body });
      id = target.id;
    } else {
      const res = await octokit.rest.issues.createComment({ ...repo(), issue_number: pullRequest, body });
      id = res.data.id;
      core.info(`Created benchmark comment ${res.data.html_url}`);
    }

    await sleep(1000 + Math.random() * 2000);
    const after = await findComments(octokit, pullRequest);
    const winner = after[0];
    if (winner && winner.id !== id && after.some((c) => c.id === id)) {
      // Another job created its comment at the same time: keep the oldest.
      await octokit.rest.issues.deleteComment({ ...repo(), comment_id: id });
    } else if (winner?.id === id && samePartsAs(parseState(winner.body), parseState(body), changed)) {
      core.info('Updated the benchmark comment.');
      return;
    }
    if (attempt >= attempts) {
      core.warning('Could not update the benchmark comment: other jobs kept overwriting it.');
      return;
    }
    core.info(`The benchmark comment changed concurrently (attempt ${attempt}/${attempts}), retrying.`);
  }
}

/** Benchmark comments on the pull request, oldest first. */
async function findComments(octokit: Octokit, pullRequest: number) {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...repo(),
    issue_number: pullRequest,
    per_page: 100,
  });
  return comments.filter((c) => c.body?.startsWith(commentMarker)).sort((a, b) => a.id - b.id);
}

type Part = 'head' | `suite:${string}`;

function changedParts(before: CommentState, after: CommentState): Part[] {
  const parts: Part[] = [];
  if (JSON.stringify(before.head) !== JSON.stringify(after.head)) parts.push('head');
  const names = new Set([...Object.keys(before.suites), ...Object.keys(after.suites)]);
  for (const name of names) {
    if (JSON.stringify(before.suites[name]) !== JSON.stringify(after.suites[name])) parts.push(`suite:${name}`);
  }
  return parts;
}

function samePartsAs(actual: CommentState, expected: CommentState, parts: Part[]): boolean {
  return parts.every((part) =>
    part === 'head'
      ? JSON.stringify(actual.head) === JSON.stringify(expected.head)
      : JSON.stringify(actual.suites[part.slice(6)]) === JSON.stringify(expected.suites[part.slice(6)]),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Link to the current workflow run. */
export function currentRunUrl(): string {
  const { serverUrl, runId } = github.context;
  const { owner, repo: name } = repo();
  return `${serverUrl}/${owner}/${name}/actions/runs/${runId}`;
}

export function defaultSiteUrl(): string | undefined {
  const { owner, repo: name } = repo();
  if ((process.env.GITHUB_SERVER_URL ?? 'https://github.com') !== 'https://github.com') return undefined;
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}
