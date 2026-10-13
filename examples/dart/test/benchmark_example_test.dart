import 'package:benchmark_example/benchmark_example.dart';
import 'package:test/test.dart';

void main() {
  test('fibonacci implementations agree', () {
    for (var n = 0; n < 25; n++) {
      expect(fibonacciIterative(n), fibonacciRecursive(n));
    }
    expect(fibonacciIterative(90), 2880067194370816120);
  });

  test('sorting', () {
    final input = [5, 3, 9, 1, 3, 0, -2];
    final expected = List.of(input)..sort();
    expect(mergeSort(input), expected);
    expect(input, [5, 3, 9, 1, 3, 0, -2], reason: 'mergeSort copies');
    insertionSort(input);
    expect(input, expected);
    expect(mergeSort([]), isEmpty);
  });

  test('wordFrequencies', () {
    expect(wordFrequencies("The cat and the hat. Don't!"), {
      'the': 2,
      'cat': 1,
      'and': 1,
      'hat': 1,
      "don't": 1,
    });
  });

  test('joinNumbers', () {
    expect(joinNumbers(0), '');
    expect(joinNumbers(4), '0,1,2,3');
  });

  test('LruCache evicts the least recently used entry', () {
    final cache = LruCache<String, int>(2);
    cache['a'] = 1;
    cache['b'] = 2;
    expect(cache['a'], 1);
    cache['c'] = 3;
    expect(cache['b'], isNull);
    expect(cache['a'], 1);
    expect(cache['c'], 3);
    expect(cache.length, 2);
  });
}
