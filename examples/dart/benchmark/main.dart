// Runs the benchmarks through package:benchmark_tracker. Run directly, it
// prints benchmark_harness reports such as
// `Fibonacci recursive (20)(RunTime): 41.2 us.` (the action's `format: dart`).
// Under the action's `mode: instructions`, it runs one benchmark at a time so
// the action can count the instructions each iteration executes.
import 'dart:convert';
import 'dart:math';

import 'package:benchmark_example/benchmark_example.dart';
import 'package:benchmark_harness/benchmark_harness.dart';
import 'package:benchmark_tracker/benchmark_tracker.dart';

class FibonacciRecursive extends BenchmarkBase {
  FibonacciRecursive() : super('Fibonacci recursive (20)');

  @override
  void run() => fibonacciRecursive(20);
}

class FibonacciIterative extends BenchmarkBase {
  FibonacciIterative() : super('Fibonacci iterative (90)');

  @override
  void run() => fibonacciIterative(90);
}

class InsertionSort extends BenchmarkBase {
  InsertionSort() : super('Insertion sort (500)');

  late List<int> _input;

  @override
  void setup() => _input = _randomList(500);

  @override
  void run() => insertionSort(List.of(_input));
}

class MergeSort extends BenchmarkBase {
  MergeSort() : super('Merge sort (500)');

  late List<int> _input;

  @override
  void setup() => _input = _randomList(500);

  @override
  void run() => mergeSort(_input);
}

class CoreListSort extends BenchmarkBase {
  CoreListSort() : super('List.sort (500)');

  late List<int> _input;

  @override
  void setup() => _input = _randomList(500);

  @override
  void run() => List.of(_input).sort();
}

class WordFrequencies extends BenchmarkBase {
  WordFrequencies() : super('Word frequencies');

  static final _text = List.filled(
    50,
    'The quick brown fox jumps over the lazy dog. ',
  ).join();

  @override
  void run() => wordFrequencies(_text);
}

class JoinNumbers extends BenchmarkBase {
  JoinNumbers() : super('Join numbers (1000)');

  @override
  void run() => joinNumbers(1000);
}

class JsonRoundTrip extends BenchmarkBase {
  JsonRoundTrip() : super('JSON round trip');

  static final _data = {
    'users': [
      for (var i = 0; i < 20; i++)
        {
          'id': i,
          'name': 'User $i',
          'tags': ['a', 'b', 'c'],
          'active': i.isEven,
        },
    ],
  };

  @override
  void run() => jsonDecode(jsonEncode(_data));
}

class LruCacheChurn extends BenchmarkBase {
  LruCacheChurn() : super('LRU cache churn');

  @override
  void run() {
    final cache = LruCache<int, int>(64);
    for (var i = 0; i < 1000; i++) {
      cache[i % 100] = i;
      cache[(i * 7) % 100];
    }
  }
}

List<int> _randomList(int length) {
  final random = Random(42);
  return List.generate(length, (_) => random.nextInt(1 << 20));
}

void main() {
  runBenchmarks([
    FibonacciRecursive(),
    FibonacciIterative(),
    InsertionSort(),
    MergeSort(),
    CoreListSort(),
    WordFrequencies(),
    JoinNumbers(),
    JsonRoundTrip(),
    LruCacheChurn(),
  ]);
}
