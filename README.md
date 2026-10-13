# Benchmark tracker

A GitHub Action that keeps your benchmark results over time.

- **On every push**, it runs your benchmarks and commits the results for that commit to a data branch (`gh-pages` by default), so a commit is never benchmarked twice.
- **A static site** on that branch charts every benchmark over time. Host it for free with GitHub Pages.
- **On every pull request**, including ones from forks, it comments with a table comparing the results against the target branch.
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

`.github/workflows/benchmark-comment.yml` posts the comment on pull requests from forks, which only get a read-only token in the first workflow:

```yaml
name: Benchmark comment

on:
  workflow_run:
    workflows: [Benchmark] # the name of the workflow above
    types: [completed]

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

### Dart

```yaml
      - uses: dart-lang/setup-dart@v1
      - run: dart pub get
      - uses: rrousselgit/benchmark@v1
        with:
          run: dart run benchmark/main.dart | tee bench.txt
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
| `push` (and any non pull request event) | Stores the results for the commit on the data branch, then compares them with the nearest earlier commit that has results. |
| `pull_request` | Compares the results with the nearest benchmarked commit of the target branch, at or before the pull request's base. Nothing is stored. Comments on the pull request when the token allows it, and always uploads the report as an artifact for the `comment` action. |

When none of the recent target branch commits were benchmarked, the most recent stored result on that branch is used. When the branch has no results at all, the comment lists the raw results without a comparison.

Data branch layout:

```
index.html, app.js, style.css   the site, refreshed on every push
data/index.json                 suites and the file of each branch
data/<suite>/<branch>.json      one entry per benchmarked commit
```

Concurrent pushes are safe: when the data branch moved in between, the action retries on a fresh copy.

## Inputs

### `rrousselgit/benchmark`

| Input | Default | Description |
| --- | --- | --- |
| `file` | required | Results file. |
| `format` | `json` | `json` or `dart`. |
| `run` | | Shell command to run first, typically the benchmark itself. |
| `suite` | `default` | Name of this set of benchmarks. Use several to track independent suites (packages, platforms) in one repository; each gets its own pull request comment. |
| `threshold` | `10%` | Change beyond which a benchmark is flagged in the comment. |
| `data-branch` | `gh-pages` | Branch storing results and the site. |
| `store` | `true` | Set to `false` to never commit results. |
| `comment` | `true` | Set to `false` to skip pull request comments. |
| `max-entries` | `0` | Commits kept per branch. `0` keeps everything. |
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

Only runs on `workflow_run`. It finds the pull request from the triggering run itself, not from the uploaded report, and re-renders the comment from the report's data, so a fork cannot use it to post arbitrary content or target another pull request.

## Noise

Shared GitHub runners are noisy, often by several percent between runs. Pick a threshold above that noise, report the median of several samples from your benchmark rather than a single run, and consider a self-hosted runner for precise tracking.

## Development

```sh
npm ci
npm run check   # typecheck, test, build
```

The actions run from the bundled files in `dist/`, `comment/dist/` and `check/dist/`, which must be rebuilt and committed with every source change. CI fails when they are out of date. This repository benchmarks itself with `examples/bench.mjs`.
