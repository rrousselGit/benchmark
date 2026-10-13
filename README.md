# Benchmark tracker

A GitHub Action that keeps your benchmark results over time.

- **On every push**, it runs your benchmarks and commits the results for that commit to a data branch (`gh-pages` by default), so a commit is never benchmarked twice.
- **A static site** on that branch charts every benchmark over time, relative to a reference commit benchmarked on the same machine, so the graph holds up on shared runners whose hardware changes from run to run. Host it for free with GitHub Pages.
- **On every pull request**, including ones from forks, it benchmarks both the pull request and its base commit in the same job, so both run on the same machine, and keeps a single comment up to date: a loading state as soon as benchmarks start, then each suite's comparison table as it comes in.
- **A separate check step** fails the job when a benchmark regresses by more than a threshold.

It reads results from a JSON file, and has a built-in adapter for Dart's [`benchmark_harness`](https://pub.dev/packages/benchmark_harness).

## Quick start

Add two workflows.

`.github/workflows/benchmark.yml` runs the benchmarks:

```yaml
name: Benchmark

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: write # push results to gh-pages
  pull-requests: write # comment on same-repository pull requests

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      # ... set up your toolchain ...
      - id: bench
        uses: rrousselgit/benchmark@v1
        with:
          run: npm run bench -- --json > bench.json
          file: bench.json
      - uses: rrousselgit/benchmark/check@v1
        with:
          report: ${{ steps.bench.outputs.report }}
          threshold: 10%
```

`.github/workflows/benchmark-comment.yml` updates the comment when a benchmark run starts and completes. It is what comments on pull requests from forks, which only get a read-only token in the first workflow, and it flags suites whose job died without reporting:

```yaml
name: Benchmark comment

on:
  workflow_run:
    workflows: [Benchmark] # the name of the workflow above
    types: [requested, completed]

permissions:
  actions: read
  pull-requests: write

jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: rrousselgit/benchmark/comment@v1
```

Then enable the site: **Settings → Pages → Build and deployment → Deploy from a branch**, and pick `gh-pages` / `(root)`. The branch is created by the first push that runs the action.

Put everything needed to build and run the benchmarks in `run`, not in earlier steps: on pull requests, the action also runs it on a checkout of the base commit.

### Dart

```yaml
      - uses: dart-lang/setup-dart@v1
      - uses: rrousselgit/benchmark@v1
        with:
          run: |
            dart pub get
            dart compile exe benchmark/main.dart -o "$RUNNER_TEMP/bench"
            "$RUNNER_TEMP/bench" | tee bench.txt
          file: bench.txt
          format: dart
```

The `dart` format reads lines printed by `benchmark_harness`, such as `Template(RunTime): 12.5 us.`, and ignores everything else.

## Results format

`format: json` (the default) accepts either an array or an object with a `benchmarks` array:

```json
{
  "benchmarks": [
    { "name": "parse", "value": 12.5, "unit": "us" },
    { "name": "throughput", "value": 5300, "unit": "ops/s", "lowerIsBetter": false }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Unique name of the benchmark. |
| `value` | yes | The measurement, as a number. |
| `unit` | no | Shown next to values. |
| `lowerIsBetter` | no | Defaults to `true`. Set to `false` for throughput-like measurements. |

## How it works

| Event | What the action does |
| --- | --- |
| `push` (and any non pull request event) | Runs the benchmarks, then runs them again on the suite's reference commit in a separate worktree. Stores both on the data branch, with the machine they were measured on, and compares with the nearest earlier commit measured against the same reference. |
| `pull_request` | Runs the benchmarks, then checks out the pull request's base commit in a separate worktree and runs them again there, and compares the two. Nothing is stored. Updates the pull request comment, and uploads the report as an artifact for the `comment` action. |

Why rerun: GitHub-hosted runners are drawn from a pool of different CPUs, and moving to another machine shifts every benchmark at once, often by 20% or more. Results are only meaningful against results from the same machine. If the base commit cannot be benchmarked (for example, the pull request adds the benchmarks), the comment says so and shows the results without a comparison.

### The reference commit

For the history to survive machine changes, every push also benchmarks one fixed commit, the suite's reference, on the same machine. The site then plots each benchmark as a percentage of the reference, which cancels out how fast that machine is. The reference is the first commit the suite stored, unless you set the `reference` input, for example to a release tag. Changing it starts a new relative series. Benchmarks that the reference commit does not have only appear in the raw timings view, so move the reference forward from time to time, for example on releases. This doubles the time of push runs, and `reference: none` turns it off.

Data branch layout:

```
index.html, app.js, style.css   the site, refreshed on every push
data/index.json                 suites and the file of each branch
data/<suite>/<branch>.json      one entry per benchmarked commit
```

Concurrent pushes are safe: when the data branch moved in between, the action retries on a fresh copy.

### The pull request comment

Each pull request gets exactly one comment, shared by all suites. Its lifecycle for a new commit:

1. When the benchmark workflow starts, the comment shows `⏳ Running benchmarks for <commit>`. Each suite job also marks its own section as running before it runs the benchmark command. Results from the previous commit stay available in a collapsed section.
2. As each suite finishes, its section is replaced by its comparison table, or by an error if the benchmark failed.
3. When the run completes, any suite that never reported (a cancelled or crashed job) is marked as failed.

The comment stores its state in a hidden HTML comment, so every job merges its own section. Jobs write concurrently, so each write is read back and retried if another job's update replaced it.

## Inputs

### `rrousselgit/benchmark`

| Input | Default | Description |
| --- | --- | --- |
| `file` | required | Results file. |
| `format` | `json` | `json` or `dart`. |
| `run` | | Shell command to run first, typically the benchmark itself. |
| `suite` | `default` | Name of this set of benchmarks. Use several to track independent suites (packages, platforms) in one repository; each gets its own section in the pull request comment. |
| `threshold` | `10%` | Change beyond which a benchmark is flagged in the comment. |
| `data-branch` | `gh-pages` | Branch storing results and the site. |
| `store` | `true` | Set to `false` to never commit results. |
| `comment` | `true` | Set to `false` to leave the pull request comment alone. |
| `max-entries` | `0` | Commits kept per branch. `0` keeps everything. |
| `reference` | first stored commit | Pushes only. Commit, tag or branch benchmarked alongside every push, see above. `none` turns it off. |
| `rerun-base` | `always` | Pull requests only. `always` benchmarks the base commit in the same job. `auto` uses stored target branch results from the same kind of machine when there are any, and reruns otherwise. `never` only uses stored results from the same kind of machine. |
| `site-url` | Pages URL | Linked from comments. |
| `github-token` | `github.token` | Needs `contents: write` to store results and `pull-requests: write` to comment. |

Outputs: `report` (path to the JSON report), `markdown`, `regressions` (count).

### `rrousselgit/benchmark/check`

| Input | Default | Description |
| --- | --- | --- |
| `report` | last report in the job | The `report` output of the main action. Pass it explicitly when the job runs several suites. |
| `threshold` | the main action's | Allowed regression, such as `10%`. |

Fails the step when any benchmark got worse than the threshold against the baseline. Passes when there is no baseline yet.

### `rrousselgit/benchmark/comment`

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `github.token` | Needs `actions: read` and `pull-requests: write`. |

Only runs on `workflow_run`, with `types: [requested, completed]`. It finds the pull request from the triggering run itself, not from the uploaded report, validates the reports, and renders the comment itself, so a fork cannot use it to post arbitrary content or target another pull request.

## Noise

Shared GitHub runners are noisy. Benchmarking the base in the same job removes the difference between machines, but neighbors on the same machine still add a few percent between runs. Pick a threshold above that noise, report the median of several samples from your benchmark rather than a single run, and consider a self-hosted runner for precise tracking.

The best fix is a machine that never changes: a self-hosted runner on fixed hardware, used only for pushes to the default branch (never for pull requests from forks). On shared runners, the site's default view, relative to the reference commit, removes most of the difference between machines. Its raw timings view mixes machines unless you filter by one.

## Development

```sh
npm ci
npm run check   # typecheck, test, build
```

The actions run from the bundled files in `dist/`, `comment/dist/` and `check/dist/`, which must be rebuilt and committed with every source change. CI fails when they are out of date.

## Examples

This repository runs the action on itself with two suites, see [`.github/workflows/benchmark.yml`](.github/workflows/benchmark.yml):

- [`examples/dart`](examples/dart): a small Dart package with `benchmark_harness` benchmarks (recursion, sorting, text processing, JSON, an LRU cache) and its tests. Run them locally with `dart run benchmark/main.dart`.
- [`examples/node`](examples/node): a few Node micro-benchmarks printing the JSON format.

Because the runners are shared, the example checks use loose thresholds (20% and 25%).
