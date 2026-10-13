import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Benchmark } from './types.js';

/**
 * Counts how many CPU instructions each benchmark iteration executes, by
 * running the benchmark under Valgrind. Unlike time, this barely depends on
 * the machine, so results stay comparable on shared CI runners.
 *
 * The command follows a small protocol (see `package:benchmark_tracker` for
 * Dart): with `BENCHMARK_LIST=<file>` it writes one benchmark name per line
 * to that file (a file, so a program that ignores the protocol is detected
 * instead of having its output taken for names); with
 * `BENCHMARK_NAME` and `BENCHMARK_ITERATIONS` it runs that benchmark's body
 * that many times. Each benchmark runs with N and 2N iterations, and the
 * difference divided by N is the cost of one iteration: startup, setup and
 * teardown cancel out.
 */
export async function countInstructions(
  command: string,
  cwd: string,
  iterations: number,
): Promise<Benchmark[]> {
  await ensureValgrind();
  const names = await listBenchmarks(command, cwd);
  core.info(`Counting instructions for ${names.length} benchmark(s), ${iterations} and ${iterations * 2} iterations each.`);

  // Instruction counts don't suffer from running in parallel, unlike timings.
  const results: Benchmark[] = new Array(names.length);
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const i = next++;
      let n = iterations;
      let once = await instructionsFor(command, cwd, names[i], n);
      let twice = await instructionsFor(command, cwd, names[i], n * 2);
      // Process noise is a few hundred instructions: for tiny benchmarks,
      // run enough iterations that it becomes negligible.
      if (twice - once < minimumMeasured) {
        const perIteration = Math.max(1, (twice - once) / n);
        n = Math.min(maximumIterations, Math.ceil(minimumMeasured / perIteration));
        once = await instructionsFor(command, cwd, names[i], n);
        twice = await instructionsFor(command, cwd, names[i], n * 2);
      }
      const value = Math.max(0, Math.round((twice - once) / n));
      core.info(`${names[i]}: ${value.toLocaleString('en-US')} instructions per iteration`);
      results[i] = { name: names[i], value, unit: 'instructions' };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, os.cpus().length) }, worker));
  return results;
}

async function listBenchmarks(command: string, cwd: string): Promise<string[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'benchmark-list-'));
  try {
    const file = path.join(dir, 'names.txt');
    await exec.exec('bash', ['-eo', 'pipefail', '-c', command], {
      cwd,
      env: { ...childEnv(), BENCHMARK_LIST: file },
      silent: true,
    });
    const content = await readFile(file, 'utf8').catch(() => {
      throw new Error(
        'The benchmark command did not write the list of its benchmarks to the file named by BENCHMARK_LIST, ' +
          'so it does not support counting instructions. For Dart, run the benchmarks with runBenchmarks from package:benchmark_tracker.',
      );
    });
    const names = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (names.length === 0) throw new Error('The benchmark command listed no benchmarks.');
    return names;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const minimumMeasured = 5_000_000;
const maximumIterations = 1_000_000;

async function instructionsFor(command: string, cwd: string, name: string, iterations: number): Promise<number> {
  const res = await exec.getExecOutput(
    'valgrind',
    [
      '--tool=cachegrind',
      '--cache-sim=no',
      '--cachegrind-out-file=/dev/null',
      '--trace-children=yes',
      'bash',
      '-eo',
      'pipefail',
      '-c',
      command,
    ],
    {
      cwd,
      env: { ...childEnv(), BENCHMARK_NAME: name, BENCHMARK_ITERATIONS: String(iterations) },
      silent: true,
      ignoreReturnCode: true,
    },
  );
  if (res.exitCode !== 0) {
    throw new Error(`Benchmark "${name}" exited with code ${res.exitCode}:\n${res.stderr.slice(-2000)}`);
  }
  return parseInstructionCount(res.stderr);
}

/** Sums the instruction counts of every process Valgrind reported on. */
export function parseInstructionCount(stderr: string): number {
  let total = 0;
  let found = false;
  for (const match of stderr.matchAll(/^==\d+== I\s+refs:\s+([\d,]+)/gm)) {
    total += Number(match[1].replace(/,/g, ''));
    found = true;
  }
  if (!found) throw new Error(`Valgrind reported no instruction count:\n${stderr.slice(-2000)}`);
  return total;
}

async function ensureValgrind(): Promise<void> {
  const check = await exec.getExecOutput('valgrind', ['--version'], { ignoreReturnCode: true, silent: true }).catch(
    () => ({ exitCode: 1 }),
  );
  if (check.exitCode === 0) return;
  if (process.platform !== 'linux') throw new Error('Counting instructions needs Valgrind, which only runs on Linux here.');
  core.info('Installing Valgrind.');
  const install = () =>
    exec.exec('sudo', ['apt-get', 'install', '-y', '-q', 'valgrind'], { ignoreReturnCode: true });
  if ((await install()) !== 0) {
    await exec.exec('sudo', ['apt-get', 'update', '-q']);
    if ((await install()) !== 0) throw new Error('Could not install Valgrind.');
  }
}

function childEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
