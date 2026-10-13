import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyIndex } from './history.js';
import type { DataIndex } from './types.js';

export interface StoreOptions {
  token: string;
  repository: string;
  branch: string;
  serverUrl: string;
  /** Directory holding the static site, copied to the branch root. */
  siteDir?: string;
  retries?: number;
}

export interface Workspace {
  dir: string;
  readJson<T>(relative: string): Promise<T | undefined>;
  writeJson(relative: string, value: unknown): Promise<void>;
  readIndex(): Promise<DataIndex>;
}

/**
 * Clones the data branch (creating it if needed), lets `mutate` change its
 * files, then commits and pushes. A rejected push (someone else pushed in
 * between) starts over from a fresh clone, so `mutate` must be repeatable.
 */
export async function updateDataBranch(
  options: StoreOptions,
  message: string,
  mutate: (workspace: Workspace) => Promise<void>,
): Promise<void> {
  const retries = options.retries ?? 5;
  core.setSecret(options.token);
  const auth = Buffer.from(`x-access-token:${options.token}`).toString('base64');
  core.setSecret(auth);
  const remote = `${options.serverUrl.replace(/\/$/, '')}/${options.repository}.git`;
  // Pass the token as a header rather than in the URL so it never lands in .git/config.
  const git = (args: string[], cwd: string, ignoreReturnCode = false) =>
    exec.getExecOutput(
      'git',
      ['-c', `http.extraheader=AUTHORIZATION: basic ${auth}`, ...args],
      { cwd, ignoreReturnCode, silent: true },
    );

  for (let attempt = 1; ; attempt++) {
    const dir = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'benchmark-data-'));
    try {
      const exists =
        (await git(['ls-remote', '--exit-code', '--heads', remote, options.branch], dir, true))
          .exitCode === 0;
      if (exists) {
        await git(['clone', '--depth', '1', '--single-branch', '--branch', options.branch, remote, '.'], dir);
      } else {
        core.info(`Creating data branch "${options.branch}".`);
        await git(['init', '--quiet'], dir);
        await git(['checkout', '--orphan', options.branch], dir);
        await git(['remote', 'add', 'origin', remote], dir);
      }

      await mutate(workspace(dir));
      if (options.siteDir) await copySite(options.siteDir, dir);

      await git(['add', '--all'], dir);
      const status = await git(['status', '--porcelain'], dir);
      if (status.stdout.trim() === '') {
        core.info('Data branch already up to date.');
        return;
      }
      await git(
        [
          '-c', 'user.name=github-actions[bot]',
          '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
          'commit', '--quiet', '-m', message,
        ],
        dir,
      );
      const push = await git(['push', 'origin', `HEAD:refs/heads/${options.branch}`], dir, true);
      if (push.exitCode === 0) {
        core.info(`Pushed results to "${options.branch}".`);
        return;
      }
      if (attempt >= retries) {
        throw new Error(`Could not push to "${options.branch}": ${push.stderr.trim()}`);
      }
      core.info(`Push rejected (attempt ${attempt}/${retries}), retrying on a fresh copy.`);
      await new Promise((r) => setTimeout(r, 1000 * attempt + Math.random() * 1000));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function workspace(dir: string): Workspace {
  const ws: Workspace = {
    dir,
    async readJson<T>(relative: string) {
      try {
        return JSON.parse(await readFile(path.join(dir, relative), 'utf8')) as T;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error(`Could not read ${relative} from the data branch: ${(e as Error).message}`);
      }
    },
    async writeJson(relative: string, value: unknown) {
      const file = path.join(dir, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(value, null, 1) + '\n');
    },
    async readIndex() {
      return (await ws.readJson<DataIndex>('data/index.json')) ?? emptyIndex();
    },
  };
  return ws;
}

async function copySite(siteDir: string, dir: string): Promise<void> {
  await cp(siteDir, dir, { recursive: true, force: true });
  // Without this file, GitHub Pages runs Jekyll and may skip some files.
  await writeFile(path.join(dir, '.nojekyll'), '');
}
