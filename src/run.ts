import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, parseThreshold } from './compare.js';
import { ancestors, defaultSiteUrl, readHistory, upsertComment, type Octokit } from './github.js';
import { addEntry, findBaseline, historyPath, registerBranch, suitePath } from './history.js';
import { renderMarkdown } from './markdown.js';
import { formats, parseResults, type Format } from './parse.js';
import { updateDataBranch } from './store.js';
import type { Benchmark, BranchHistory, Entry, Report } from './types.js';

export const artifactPrefix = 'benchmark-report-';

async function main(): Promise<void> {
  const inputs = readInputs();
  const octokit = github.getOctokit(inputs.token);
  const { context } = github;

  if (inputs.command) {
    const exitCode = await exec.exec('bash', ['-c', inputs.command], { ignoreReturnCode: true });
    if (exitCode !== 0) throw new Error(`Benchmark command exited with code ${exitCode}.`);
  }
  const benchmarks = parseResults(await readFile(inputs.file, 'utf8'), inputs.format);
  core.info(`Parsed ${benchmarks.length} benchmark(s) from ${inputs.file}.`);

  const pr = context.payload.pull_request;
  const report = pr
    ? await pullRequestReport(octokit, inputs, benchmarks, pr)
    : await storeAndReport(octokit, inputs, benchmarks);

  const markdown = renderMarkdown(report);
  const reportDir = path.join(process.env.RUNNER_TEMP ?? '.', 'benchmark-action');
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `report-${inputs.suite}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  core.setOutput('report', reportPath);
  core.setOutput('markdown', markdown);
  core.setOutput('regressions', report.rows.filter((r) => r.status === 'regression').length);
  core.exportVariable('BENCHMARK_REPORT', reportPath);
  await core.summary.addRaw(markdown).write();

  if (pr && inputs.comment) {
    await commentOnPullRequest(octokit, inputs, report, markdown, reportPath);
  }
}

interface Inputs {
  token: string;
  file: string;
  format: Format;
  command: string;
  suite: string;
  dataBranch: string;
  threshold: number;
  store: boolean;
  comment: boolean;
  maxEntries: number;
  siteUrl?: string;
}

function readInputs(): Inputs {
  const format = core.getInput('format') || 'json';
  if (!formats.includes(format as Format)) {
    throw new Error(`Unknown format "${format}". Expected one of: ${formats.join(', ')}.`);
  }
  const dataBranch = core.getInput('data-branch') || 'gh-pages';
  const siteUrl = core.getInput('site-url') || (dataBranch === 'gh-pages' ? defaultSiteUrl() : undefined);
  const maxEntries = Number(core.getInput('max-entries') || '0');
  if (!Number.isInteger(maxEntries) || maxEntries < 0) {
    throw new Error('max-entries must be a non-negative integer.');
  }
  return {
    token: core.getInput('github-token', { required: true }),
    file: core.getInput('file', { required: true }),
    format: format as Format,
    command: core.getInput('run'),
    suite: suitePath(core.getInput('suite') || 'default'),
    dataBranch,
    threshold: parseThreshold(core.getInput('threshold') || '10%'),
    store: core.getBooleanInput('store'),
    comment: core.getBooleanInput('comment'),
    maxEntries,
    siteUrl: siteUrl || undefined,
  };
}

function toReport(
  inputs: Inputs,
  benchmarks: Benchmark[],
  current: Report['current'],
  baseline: Entry | undefined,
): Report {
  return {
    version: 1,
    suite: inputs.suite,
    threshold: inputs.threshold,
    current,
    baseline: baseline && { sha: baseline.commit.sha, branch: baseline.branch },
    siteUrl: inputs.siteUrl,
    rows: compare(benchmarks, baseline?.benchmarks, inputs.threshold),
  };
}

/** Pull requests: compare against the stored results of the target branch. */
async function pullRequestReport(
  octokit: Octokit,
  inputs: Inputs,
  benchmarks: Benchmark[],
  pr: NonNullable<typeof github.context.payload.pull_request>,
): Promise<Report> {
  const baseRef: string = pr.base.ref;
  const baseSha: string = pr.base.sha;
  const history = await readHistory(octokit, inputs.dataBranch, inputs.suite, baseRef);
  const baseline = history && findBaseline(history.entries, await ancestors(octokit, baseSha));
  if (baseline) {
    core.info(`Comparing against ${baseline.commit.sha} on ${baseRef}.`);
  } else {
    core.info(`No stored results for ${baseRef}; reporting without a comparison.`);
  }
  return {
    ...toReport(inputs, benchmarks, { sha: pr.head.sha, ref: pr.head.ref }, baseline),
    pullRequest: pr.number,
  };
}

/** Pushes and other events: store results for this commit, compare against its ancestor. */
async function storeAndReport(
  octokit: Octokit,
  inputs: Inputs,
  benchmarks: Benchmark[],
): Promise<Report> {
  const { context } = github;
  const branch = process.env.GITHUB_REF_NAME || context.ref.replace(/^refs\/(heads|tags)\//, '');
  const entry = await currentEntry(octokit, branch, benchmarks);
  const history = await ancestors(octokit, context.sha);
  let baseline: Entry | undefined;

  if (!inputs.store) {
    const stored = await readHistory(octokit, inputs.dataBranch, inputs.suite, branch);
    baseline = stored && findBaseline(stored.entries, history, context.sha);
  } else {
    await updateDataBranch(
      {
        token: inputs.token,
        repository: `${context.repo.owner}/${context.repo.repo}`,
        branch: inputs.dataBranch,
        serverUrl: context.serverUrl,
        siteDir: siteDir(),
      },
      `Add ${inputs.suite} benchmark results for ${context.sha.slice(0, 7)}`,
      async (ws) => {
        const index = await ws.readIndex();
        registerBranch(index, inputs.suite, branch);
        const file = historyPath(index, inputs.suite, branch);
        const stored = (await ws.readJson<BranchHistory>(file)) ?? {
          suite: inputs.suite,
          branch,
          entries: [],
        };
        baseline = findBaseline(stored.entries, history, context.sha);
        await ws.writeJson(file, addEntry(stored, entry, inputs.maxEntries));
        await ws.writeJson('data/index.json', index);
      },
    );
  }
  return toReport(inputs, benchmarks, { sha: context.sha, ref: branch }, baseline);
}

async function currentEntry(octokit: Octokit, branch: string, benchmarks: Benchmark[]): Promise<Entry> {
  const { context } = github;
  const head = context.payload.head_commit as
    | { id: string; message: string; timestamp: string; url: string; author?: { name?: string; username?: string } }
    | undefined;
  let commit: Entry['commit'];
  if (head && head.id === context.sha) {
    commit = {
      sha: head.id,
      message: head.message,
      author: head.author?.username ?? head.author?.name ?? '',
      timestamp: head.timestamp,
      url: head.url,
    };
  } else {
    const res = await octokit.rest.repos.getCommit({ ...context.repo, ref: context.sha });
    commit = {
      sha: res.data.sha,
      message: res.data.commit.message,
      author: res.data.author?.login ?? res.data.commit.author?.name ?? '',
      timestamp: res.data.commit.committer?.date ?? res.data.commit.author?.date ?? new Date().toISOString(),
      url: res.data.html_url,
    };
  }
  return { commit, branch, runAt: new Date().toISOString(), benchmarks };
}

async function commentOnPullRequest(
  octokit: Octokit,
  inputs: Inputs,
  report: Report,
  markdown: string,
  reportPath: string,
): Promise<void> {
  // Always upload the report: pull requests from forks get a read-only token,
  // and the companion `comment` action posts it from a trusted workflow.
  try {
    await new DefaultArtifactClient().uploadArtifact(
      `${artifactPrefix}${inputs.suite}`,
      [reportPath],
      path.dirname(reportPath),
    );
  } catch (e) {
    core.warning(`Could not upload the report artifact: ${(e as Error).message}`);
  }

  try {
    await upsertComment(octokit, report.pullRequest!, inputs.suite, markdown);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 403 || status === 404) {
      core.info(
        'This token cannot comment (usually a pull request from a fork). ' +
          'The comment will be posted by the workflow using rrousselgit/benchmark/comment.',
      );
    } else {
      throw e;
    }
  }
}

function siteDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
}

main().catch((e: Error) => core.setFailed(e.message));
