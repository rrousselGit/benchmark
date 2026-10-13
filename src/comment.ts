import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finishHead, finishSuite, startHead, validateReport } from './comment-state.js';
import { updateBenchmarkComment, type Octokit } from './github.js';
import type { Report } from './types.js';

const artifactPrefix = 'benchmark-report-';

/**
 * Runs on `workflow_run` (types `requested` and `completed`), with a token
 * that can write, so pull requests from forks get the comment too: a
 * loading comment when their benchmark run starts, then its results.
 *
 * The reports come from untrusted code, so only their data is used: the
 * pull request is looked up from the run itself, reports are validated,
 * and the markdown is rendered here.
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
  const sha: string = run.head_sha;
  const runUrl: string = run.html_url;

  if (context.payload.action !== 'completed') {
    await updateBenchmarkComment(octokit, pullRequest, (state) => startHead(state, sha, runUrl));
    return;
  }

  const reports = await downloadReports(token, run.id as number);
  await updateBenchmarkComment(octokit, pullRequest, (state) => {
    startHead(state, sha, runUrl);
    for (const report of reports) {
      if (report.current.sha !== sha) {
        core.warning(`Ignoring the ${report.suite} report: it is for ${report.current.sha}, not ${sha}.`);
        continue;
      }
      report.pullRequest = pullRequest;
      finishSuite(state, report, runUrl);
    }
    finishHead(state, sha, run.conclusion ?? 'unknown', runUrl);
  });
}

async function downloadReports(token: string, workflowRunId: number): Promise<Report[]> {
  const { context } = github;
  const client = new DefaultArtifactClient();
  const findBy = {
    token,
    workflowRunId,
    repositoryOwner: context.repo.owner,
    repositoryName: context.repo.repo,
  };
  const { artifacts } = await client.listArtifacts({ findBy, latest: true });
  const reports: Report[] = [];
  for (const artifact of artifacts.filter((a) => a.name.startsWith(artifactPrefix))) {
    const dir = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'benchmark-report-'));
    await client.downloadArtifact(artifact.id, { path: dir, findBy });
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const report = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Report;
        validateReport(report);
        reports.push(report);
      } catch (e) {
        core.warning(`Ignoring malformed report ${artifact.name}: ${(e as Error).message}`);
      }
    }
  }
  core.info(`Found ${reports.length} benchmark report(s).`);
  return reports;
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

main().catch((e: Error) => core.setFailed(e.message));
