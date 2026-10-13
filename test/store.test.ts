import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { updateDataBranch } from '../src/store.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('updateDataBranch', () => {
  it('creates the branch, then appends to it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bench-store-'));
    const remote = path.join(root, 'owner', 'repo.git');
    mkdirSync(remote, { recursive: true });
    git(remote, 'init', '--bare', '--quiet');
    const site = path.join(root, 'site');
    mkdirSync(site);
    writeFileSync(path.join(site, 'index.html'), '<p>site</p>');

    const options = {
      token: 'test-token',
      repository: 'owner/repo',
      branch: 'gh-pages',
      serverUrl: `file://${root}`,
      siteDir: site,
    };
    for (const n of [1, 2]) {
      await updateDataBranch(options, `run ${n}`, async (ws) => {
        const data = (await ws.readJson<number[]>('data/runs.json')) ?? [];
        await ws.writeJson('data/runs.json', [...data, n]);
      });
    }

    const checkout = path.join(root, 'checkout');
    git(root, 'clone', '--quiet', '--branch', 'gh-pages', remote, checkout);
    expect(JSON.parse(readFileSync(path.join(checkout, 'data/runs.json'), 'utf8'))).toEqual([1, 2]);
    expect(readFileSync(path.join(checkout, 'index.html'), 'utf8')).toBe('<p>site</p>');
    expect(git(checkout, 'log', '--format=%s')).toBe('run 2\nrun 1');
    expect(git(checkout, 'log', '-1', '--format=%an')).toBe('github-actions[bot]');
  });
});
