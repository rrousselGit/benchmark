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
  test('lists benchmark names', () {
    final lines = <String>[];
    runBenchmarks(
      [Counter('a'), Counter('b')],
      environment: {'BENCHMARK_LIST': '1'},
      log: lines.add,
    );
    expect(lines, ['a', 'b']);
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
