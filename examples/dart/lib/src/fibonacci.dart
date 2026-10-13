/// Naive recursive Fibonacci, deliberately slow.
int fibonacciRecursive(int n) =>
    n < 2 ? n : fibonacciRecursive(n - 1) + fibonacciRecursive(n - 2);

/// Linear-time Fibonacci.
int fibonacciIterative(int n) {
  var a = 0, b = 1;
  for (var i = 0; i < n; i++) {
    final next = a + b;
    a = b;
    b = next;
  }
  return a;
}
