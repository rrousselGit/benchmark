import 'dart:io';

import 'package:benchmark_harness/benchmark_harness.dart';
import 'package:benchmark_tracker/benchmark_tracker.dart';
import 'package:test/test.dart';

class Counter extends BenchmarkBase {
  Counter(super.name);

  final calls = <String>[];

  @override
  void setup() => calls.add('setup');

  @override
  void run() => calls.add('run');

  @override
  void teardown() => calls.add('teardown');
}

void main() {
  test('lists benchmark names to a file', () {
    final dir = Directory.systemTemp.createTempSync();
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/names.txt');
    runBenchmarks(
      [Counter('a'), Counter('b')],
      environment: {'BENCHMARK_LIST': file.path},
    );
    expect(file.readAsLinesSync(), ['a', 'b']);
  });

  test('runs one benchmark a fixed number of times', () {
    final a = Counter('a'), b = Counter('b');
    runBenchmarks(
      [a, b],
      environment: {'BENCHMARK_NAME': 'b', 'BENCHMARK_ITERATIONS': '3'},
    );
    expect(a.calls, isEmpty);
    expect(b.calls, ['setup', 'run', 'run', 'run', 'teardown']);
  });

  test('rejects unknown and duplicate names', () {
    expect(
      () => runBenchmarks([Counter('a')], environment: {'BENCHMARK_NAME': 'x'}),
      throwsArgumentError,
    );
    expect(
      () => runBenchmarks([Counter('a'), Counter('a')], environment: {}),
      throwsArgumentError,
    );
  });
}
