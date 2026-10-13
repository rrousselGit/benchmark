import * as core from '@actions/core';
import * as github from '@actions/github';
import { commentMarker } from './markdown.js';
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

/** Creates the suite's comment on a pull request, or updates it in place. */
export async function upsertComment(
  octokit: Octokit,
  pullRequest: number,
  suite: string,
  body: string,
): Promise<void> {
  const marker = commentMarker(suite);
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...repo(),
    issue_number: pullRequest,
    per_page: 100,
  });
  const existing = comments.find((c) => c.body?.startsWith(marker));
  if (existing) {
    await octokit.rest.issues.updateComment({ ...repo(), comment_id: existing.id, body });
    core.info(`Updated benchmark comment ${existing.html_url}`);
  } else {
    const res = await octokit.rest.issues.createComment({ ...repo(), issue_number: pullRequest, body });
    core.info(`Created benchmark comment ${res.data.html_url}`);
  }
}

export function defaultSiteUrl(): string | undefined {
  const { owner, repo: name } = repo();
  if ((process.env.GITHUB_SERVER_URL ?? 'https://github.com') !== 'https://github.com') return undefined;
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}
