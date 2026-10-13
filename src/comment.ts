import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { upsertComment, type Octokit } from './github.js';
import { suitePath } from './history.js';
import { renderMarkdown } from './markdown.js';
import type { Report } from './types.js';

const artifactPrefix = 'benchmark-report-';

/**
 * Runs on `workflow_run`, with a token that can write. Downloads the reports
 * uploaded by a pull request's benchmark run and posts them as comments.
 * The reports come from untrusted code, so only their data is used: the
 * pull request is looked up from the run itself, and markdown is re-rendered.
 */
async function main(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const octokit = github.getOctokit(token);
  const { context } = github;
  const run = context.payload.workflow_run;
  if (context.eventName !== 'workflow_run' || !run) {
    throw new Error('rrousselgit/benchmark/comment must run on a "workflow_run" event.');
  }
  if (run.event !== 'pull_request') {
    core.info(`Triggering run was a "${run.event}" event, not a pull request. Nothing to do.`);
    return;
  }

  const pullRequest = await findPullRequest(octokit, run);
  if (!pullRequest) {
    core.info(`No open pull request has head ${run.head_sha}. Nothing to do.`);
    return;
  }

  const client = new DefaultArtifactClient();
  const findBy = {
    token,
    workflowRunId: run.id as number,
    repositoryOwner: context.repo.owner,
    repositoryName: context.repo.repo,
  };
  const { artifacts } = await client.listArtifacts({ findBy, latest: true });
  const reports = artifacts.filter((a) => a.name.startsWith(artifactPrefix));
  if (reports.length === 0) {
    core.info('The triggering run uploaded no benchmark reports.');
    return;
  }

  for (const artifact of reports) {
    const dir = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'benchmark-report-'));
    await client.downloadArtifact(artifact.id, { path: dir, findBy });
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.json')) continue;
      const report = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Report;
      validate(report);
      report.pullRequest = pullRequest;
      await upsertComment(octokit, pullRequest, report.suite, renderMarkdown(report));
    }
  }
}

async function findPullRequest(
  octokit: Octokit,
  run: NonNullable<typeof github.context.payload.workflow_run>,
): Promise<number | undefined> {
  const listed = (run.pull_requests ?? []) as { number: number; head: { sha: string } }[];
  const direct = listed.find((p) => p.head.sha === run.head_sha);
  if (direct) return direct.number;

  // `pull_requests` is empty for runs from forks, so search by head branch.
  const owner: string | undefined = run.head_repository?.owner?.login;
  if (!owner) return undefined;
  const prs = await octokit.paginate(octokit.rest.pulls.list, {
    ...github.context.repo,
    state: 'open',
    head: `${owner}:${run.head_branch}`,
    per_page: 100,
  });
  return prs.find((p) => p.head.sha === run.head_sha)?.number;
}

function validate(report: Report): void {
  if (report?.version !== 1 || !Array.isArray(report.rows) || typeof report.suite !== 'string') {
    throw new Error('Malformed benchmark report artifact.');
  }
  suitePath(report.suite);
  if (typeof report.threshold !== 'number') throw new Error('Malformed report threshold.');
  for (const row of report.rows) {
    if (typeof row.name !== 'string' || typeof row.unit !== 'string' || typeof row.status !== 'string') {
      throw new Error('Malformed report row.');
    }
    for (const key of ['base', 'current', 'changePercent'] as const) {
      if (row[key] !== undefined && typeof row[key] !== 'number') throw new Error('Malformed report value.');
    }
  }
  for (const sha of [report.current?.sha, report.baseline?.sha]) {
    if (sha !== undefined && !/^[0-9a-f]{7,64}$/.test(sha)) throw new Error('Malformed commit sha.');
  }
  if (report.siteUrl !== undefined && !/^https:\/\/[^\s()<>]+$/.test(report.siteUrl)) {
    throw new Error('Malformed site URL.');
  }
}

main().catch((e: Error) => core.setFailed(e.message));
