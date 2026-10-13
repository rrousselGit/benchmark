/// Runs `package:benchmark_harness` benchmarks in the way
/// rrousselgit/benchmark asks for through environment variables.
library;

import 'dart:io';

import 'package:benchmark_harness/benchmark_harness.dart';

/// Runs [benchmarks] according to the environment:
///
/// - `BENCHMARK_LIST=<path>`: writes each benchmark name on its own line to
///   that file. Using a file rather than standard output lets the action tell
///   a program that follows this protocol from one that ignores it.
/// - `BENCHMARK_NAME=<name>` and `BENCHMARK_ITERATIONS=<n>`: runs that
///   benchmark's `setup`, then `run` n times, then `teardown`, and prints
///   nothing. The action counts the instructions this executes.
/// - Otherwise: reports every benchmark's time, like `report()` does.
void runBenchmarks(
  List<BenchmarkBase> benchmarks, {
  Map<String, String>? environment,
}) {
  final env = environment ?? Platform.environment;
  final names = <String>{};
  for (final benchmark in benchmarks) {
    if (!names.add(benchmark.name)) {
      throw ArgumentError('Duplicate benchmark name "${benchmark.name}".');
    }
  }

  final listPath = env['BENCHMARK_LIST'];
  if (listPath != null) {
    File(
      listPath,
    ).writeAsStringSync(benchmarks.map((b) => '${b.name}\n').join());
    return;
  }

  final name = env['BENCHMARK_NAME'];
  if (name != null) {
    final benchmark = benchmarks.where((b) => b.name == name).firstOrNull;
    if (benchmark == null) throw ArgumentError('No benchmark named "$name".');
    final iterations = int.parse(env['BENCHMARK_ITERATIONS'] ?? '1');
    benchmark.setup();
    for (var i = 0; i < iterations; i++) {
      benchmark.run();
    }
    benchmark.teardown();
    return;
  }

  for (final benchmark in benchmarks) {
    benchmark.report();
  }
}
